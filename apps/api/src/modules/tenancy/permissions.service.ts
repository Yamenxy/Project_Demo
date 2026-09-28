import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { AppError, Clock, IdGenerator } from '../../common';
import {
  CLASS_TEACHER_DEFAULTS,
  CLASS_TEACHER_ONLY,
  isGrantable,
  isPermissionKey,
  PERMISSION_KEYS,
  type PermissionKey,
} from '../../common/policy';
import type { DbTx } from '../../database';
import { AuditService } from '../audit';
import { memberships, permissionGrants, type MembershipRole } from './schema';

/**
 * The permissions a member holds in the workspace. Class-level scopes (REQ-RBAC-001) arrive with
 * the classes table in Phase 4; until then every grant covers all the member's classes.
 */
export class PermissionSet {
  constructor(private readonly keys: ReadonlySet<PermissionKey>) {}

  has(key: PermissionKey): boolean {
    return this.keys.has(key);
  }

  list(): PermissionKey[] {
    return PERMISSION_KEYS.filter((key) => this.keys.has(key));
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

  /** Computes a member's permissions (read fresh on every request, so changes apply at once). */
  async forMembership(
    tx: DbTx,
    membershipId: string,
    role: MembershipRole,
  ): Promise<PermissionSet> {
    if (role === 'owner') return new PermissionSet(new Set(PERMISSION_KEYS));
    if (role === 'student') return new PermissionSet(new Set());
    const rows = await tx
      .select({ permission: permissionGrants.permission })
      .from(permissionGrants)
      .where(eq(permissionGrants.membershipId, membershipId));
    const keys = new Set<PermissionKey>(role === 'class_teacher' ? CLASS_TEACHER_DEFAULTS : []);
    for (const { permission } of rows) {
      // Defence in depth: ignore anything the role may not hold, even if a row exists.
      if (
        isPermissionKey(permission) &&
        (role === 'class_teacher' || !CLASS_TEACHER_ONLY.has(permission))
      ) {
        keys.add(permission);
      }
    }
    return new PermissionSet(keys);
  }

  /** Owner grants a key to a helper or class teacher. Idempotent. */
  async grant(
    tx: DbTx,
    workspaceId: string,
    membershipId: string,
    key: string,
    actor: GrantActor,
  ): Promise<void> {
    const target = await this.grantTarget(tx, membershipId, key);
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
    if (inserted.length > 0) {
      await this.audit.record(tx, {
        action: 'permission.granted',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        newValue: { permission: target.key },
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

  private async grantTarget(
    tx: DbTx,
    membershipId: string,
    key: string,
  ): Promise<{ key: PermissionKey }> {
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
    return { key };
  }
}
