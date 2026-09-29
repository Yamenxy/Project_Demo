import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator } from '../../common';
import {
  CLASS_TEACHER_DEFAULTS,
  CLASS_TEACHER_ONLY,
  isGrantable,
  isPermissionKey,
  PERMISSION_KEYS,
  type PermissionKey,
  WORKSPACE_ONLY,
} from '../../common/policy';
import type { DbTx } from '../../database';
import { AuditService } from '../audit';
import {
  memberships,
  permissionGrantClasses,
  permissionGrants,
  type MembershipRole,
} from './schema';

/** Where a permission applies: the whole workspace, or only some classes (REQ-RBAC-001). */
export type PermissionScope = 'all' | ReadonlySet<string>;

/** The permissions a member holds in the workspace, each with its class scope. */
export class PermissionSet {
  constructor(private readonly scopes: ReadonlyMap<PermissionKey, PermissionScope>) {}

  has(key: PermissionKey): boolean {
    return this.scopes.has(key);
  }

  /** Whether the key covers the whole workspace (not only some classes). */
  hasEverywhere(key: PermissionKey): boolean {
    return this.scopes.get(key) === 'all';
  }

  /** 'all', the class ids the key covers, or an empty set when it isn't held. */
  scopeOf(key: PermissionKey): PermissionScope {
    return this.scopes.get(key) ?? new Set();
  }

  coversClass(key: PermissionKey, classId: string): boolean {
    const scope = this.scopes.get(key);
    return scope === 'all' || (scope?.has(classId) ?? false);
  }

  list(): PermissionKey[] {
    return PERMISSION_KEYS.filter((key) => this.scopes.has(key));
  }
}

export interface GrantActor {
  userId: string;
  requestId?: string;
}

@Injectable()
export class PermissionsService {
  constructor(
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * Computes a member's permissions (read fresh on every request, so changes apply at once).
   * The owner holds everything everywhere. A class teacher's keys cover only the classes they're
   * responsible for (REQ-RBAC-006). A helper's grant covers the workspace, or the classes it lists.
   */
  async forMembership(
    tx: DbTx,
    membershipId: string,
    role: MembershipRole,
  ): Promise<PermissionSet> {
    if (role === 'owner') {
      return new PermissionSet(new Map(PERMISSION_KEYS.map((key) => [key, 'all'] as const)));
    }
    if (role === 'student') return new PermissionSet(new Map());
    const rows = await tx
      .select({
        permission: permissionGrants.permission,
        classId: permissionGrantClasses.classId,
      })
      .from(permissionGrants)
      .leftJoin(permissionGrantClasses, eq(permissionGrantClasses.grantId, permissionGrants.id))
      .where(eq(permissionGrants.membershipId, membershipId));
    const scopes = new Map<PermissionKey, PermissionScope>();
    if (role === 'class_teacher') {
      // The classes table belongs to the classes module, which depends on tenancy: read it by name.
      const owned = await tx.execute<{ id: string }>(
        sql`select id from classes where responsible_membership_id = ${membershipId}`,
      );
      const classIds = new Set(owned.rows.map((r) => r.id));
      const keys = new Set<PermissionKey>(CLASS_TEACHER_DEFAULTS);
      for (const { permission } of rows) if (isPermissionKey(permission)) keys.add(permission);
      for (const key of keys) scopes.set(key, WORKSPACE_ONLY.has(key) ? 'all' : classIds);
      return new PermissionSet(scopes);
    }
    for (const { permission, classId } of rows) {
      // Defence in depth: ignore anything the role may not hold, even if a row exists.
      if (!isPermissionKey(permission) || CLASS_TEACHER_ONLY.has(permission)) continue;
      const current = scopes.get(permission);
      if (classId === null) scopes.set(permission, 'all');
      else if (current !== 'all') {
        scopes.set(permission, new Set([...(current ?? []), classId]));
      }
    }
    return new PermissionSet(scopes);
  }

  /**
   * Owner grants a key to a helper or class teacher: for the whole workspace or, for a helper,
   * only some classes. Granting again replaces the classes. Idempotent.
   */
  async grant(
    tx: DbTx,
    workspaceId: string,
    membershipId: string,
    key: string,
    actor: GrantActor,
    classIds: string[] = [],
  ): Promise<void> {
    const target = await this.grantTarget(tx, membershipId, key);
    const scoped = [...new Set(classIds)];
    if (scoped.length > 0 && (target.role !== 'assistant' || WORKSPACE_ONLY.has(target.key))) {
      throw new AppError(400, 'permission_not_class_scoped', 'This permission has no class scope');
    }
    const [existing] = await tx
      .select({ id: permissionGrants.id })
      .from(permissionGrants)
      .where(
        and(
          eq(permissionGrants.membershipId, membershipId),
          eq(permissionGrants.permission, target.key),
        ),
      );
    if (existing) {
      const before = await tx
        .select({ classId: permissionGrantClasses.classId })
        .from(permissionGrantClasses)
        .where(eq(permissionGrantClasses.grantId, existing.id));
      const same =
        before.length === scoped.length && before.every((r) => scoped.includes(r.classId));
      if (same) return;
      await tx
        .delete(permissionGrantClasses)
        .where(eq(permissionGrantClasses.grantId, existing.id));
      await this.insertScopes(tx, workspaceId, existing.id, scoped);
      await this.audit.record(tx, {
        action: 'permission.scope_changed',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        oldValue: { permission: target.key, classIds: before.map((r) => r.classId) },
        newValue: { permission: target.key, classIds: scoped },
        requestId: actor.requestId,
      });
      return;
    }
    const inserted = await tx
      .insert(permissionGrants)
      .values({
        workspaceId,
        id: this.ids.newId(),
        membershipId,
        permission: target.key,
        grantedBy: actor.userId,
        createdAt: this.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: permissionGrants.id });
    const grantId = inserted[0]?.id;
    if (grantId) {
      await this.insertScopes(tx, workspaceId, grantId, scoped);
      await this.audit.record(tx, {
        action: 'permission.granted',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        newValue: { permission: target.key, classIds: scoped },
        requestId: actor.requestId,
      });
    }
  }

  /** Owner revokes a key. Idempotent. */
  async revoke(
    tx: DbTx,
    workspaceId: string,
    membershipId: string,
    key: string,
    actor: GrantActor,
  ): Promise<void> {
    const target = await this.grantTarget(tx, membershipId, key);
    const removed = await tx
      .delete(permissionGrants)
      .where(
        and(
          eq(permissionGrants.membershipId, membershipId),
          eq(permissionGrants.permission, target.key),
        ),
      )
      .returning({ id: permissionGrants.id });
    if (removed.length > 0) {
      await this.audit.record(tx, {
        action: 'permission.revoked',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        oldValue: { permission: target.key },
        requestId: actor.requestId,
      });
    }
  }

  private async insertScopes(
    tx: DbTx,
    workspaceId: string,
    grantId: string,
    classIds: string[],
  ): Promise<void> {
    if (classIds.length === 0) return;
    const found = await tx.execute<{ id: string }>(
      sql`select id from classes where id in ${classIds} and archived_at is null`,
    );
    if (found.rows.length !== classIds.length) {
      throw new AppError(404, 'not_found', 'Class not found');
    }
    await tx
      .insert(permissionGrantClasses)
      .values(classIds.map((classId) => ({ workspaceId, grantId, classId })));
  }

  private async grantTarget(
    tx: DbTx,
    membershipId: string,
    key: string,
  ): Promise<{ key: PermissionKey; role: 'assistant' | 'class_teacher' }> {
    if (!isPermissionKey(key)) {
      throw new AppError(400, 'permission_not_grantable', 'Unknown or owner-only permission');
    }
    const [member] = await tx
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.id, membershipId));
    // Scoped to the workspace by RLS: a membership elsewhere simply isn't found.
    if (!member || member.status === 'removed') {
      throw new AppError(404, 'not_found', 'Membership not found');
    }
    if (member.role !== 'assistant' && member.role !== 'class_teacher') {
      throw new AppError(400, 'permission_not_grantable', 'Only staff can hold permissions');
    }
    if (!isGrantable(member.role, key)) {
      throw new AppError(400, 'permission_not_grantable', 'This role cannot hold that permission');
    }
    return { key, role: member.role };
  }
}
