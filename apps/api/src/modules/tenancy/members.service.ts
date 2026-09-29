import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { AppError, notFound } from '../../common';
import { TenantDb } from '../../database';
import { AuditService } from '../audit';
import { DevicesService } from '../identity';
import { NotificationsService } from '../notify';
import { memberships } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

/** Staff actions on a member of the workspace. */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: TenantDb,
    private readonly devices: DevicesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Resets a student's devices (REQ-AUTH-005): every device and session ends and a new
   * registration window opens. Used when a student hits the device limit or cooldown.
   */
  async resetStudentDevices(
    workspaceId: string,
    membershipId: string,
    actor: Actor,
  ): Promise<number> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      // RLS scopes this to the workspace: a membership elsewhere isn't found (404).
      const [member] = await tx
        .select({ userId: memberships.userId, role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.id, membershipId), ne(memberships.status, 'removed')));
      if (!member) throw notFound('Membership not found');
      if (member.role !== 'student' || !member.userId) {
        throw new AppError(400, 'not_a_student_account', 'Only student accounts can be reset');
      }
      const revoked = await this.devices.resetForUser(tx, member.userId, 'staff');
      await this.audit.record(tx, {
        action: 'student.devices_reset',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        newValue: { revokedDevices: revoked },
        requestId: actor.requestId,
      });
      await this.notifications.notify(tx, {
        recipientUserId: member.userId,
        workspaceId,
        type: 'account.devices_reset',
        link: '/account',
      });
      return revoked;
    });
  }
}
