import { Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { Clock, notFound } from '../../common';
import { CLASS_TEACHER_DEFAULTS, type PermissionKey } from '../../common/policy';
import { TenantDb } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { memberships, permissionGrants, type MembershipStatus } from './schema';

export interface StaffMember {
  membershipId: string;
  userId: string;
  name: string;
  phoneE164: string;
  role: 'class_teacher' | 'assistant';
  status: MembershipStatus;
  /** Keys granted by the owner (class teachers also hold their default bundle). */
  granted: PermissionKey[];
  defaults: PermissionKey[];
}

export interface Actor {
  userId: string;
  requestId?: string;
}

/** The owner's view of their staff (OD-01): class teachers and helpers. */
@Injectable()
export class StaffService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async list(workspaceId: string): Promise<StaffMember[]> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const rows = await tx
        .select({
          membershipId: memberships.id,
          userId: memberships.userId,
          role: memberships.role,
          status: memberships.status,
          name: users.nameAr,
          phoneE164: users.phoneE164,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            inArray(memberships.role, ['class_teacher', 'assistant']),
            inArray(memberships.status, ['active', 'suspended']),
          ),
        )
        .orderBy(users.nameAr);
      const grants = rows.length
        ? await tx
            .select({
              membershipId: permissionGrants.membershipId,
              permission: permissionGrants.permission,
            })
            .from(permissionGrants)
            .where(
              inArray(
                permissionGrants.membershipId,
                rows.map((r) => r.membershipId),
              ),
            )
        : [];
      return rows.map((row) => ({
        membershipId: row.membershipId,
        userId: row.userId ?? '',
        name: row.name,
        phoneE164: row.phoneE164,
        role: row.role as 'class_teacher' | 'assistant',
        status: row.status,
        granted: grants
          .filter((g) => g.membershipId === row.membershipId)
          .map((g) => g.permission as PermissionKey),
        defaults: row.role === 'class_teacher' ? [...CLASS_TEACHER_DEFAULTS] : [],
      }));
    });
  }

  /**
   * Removes a staff member. Access ends on their next request, because the access guard reads
   * the membership fresh each time (REQ-USER-005).
   */
  async remove(workspaceId: string, membershipId: string, actor: Actor): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const removed = await tx
        .update(memberships)
        .set({ status: 'removed', updatedAt: this.clock.now() })
        .where(
          and(
            eq(memberships.id, membershipId),
            inArray(memberships.role, ['class_teacher', 'assistant']),
            inArray(memberships.status, ['active', 'suspended']),
          ),
        )
        .returning({ id: memberships.id });
      if (removed.length === 0) throw notFound('Staff member not found');
      await tx.delete(permissionGrants).where(eq(permissionGrants.membershipId, membershipId));
      await this.audit.record(tx, {
        action: 'staff.removed',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        requestId: actor.requestId,
      });
    });
  }
}
