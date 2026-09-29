import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { normalizePhone } from '@lms/shared';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { isUuid, TenantDb } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { NotificationsService } from '../notify';
import { memberships, workspaceInvitations, workspaces } from './schema';

export type StaffRole = 'class_teacher' | 'assistant';

const INVITATION_TTL_MS = 7 * 24 * 3600 * 1000; // REQ-USER-005

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface InvitationView {
  id: string;
  phoneE164: string;
  role: StaffRole;
  createdAt: Date;
  expiresAt: Date;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Staff invitations (REQ-USER-005): the owner invites a class teacher or helper by phone and
 * shares the link (for example on WhatsApp). The invitee accepts while signed in with that same,
 * verified number. The response never reveals whether the number has an account (SEC-02).
 */
@Injectable()
export class InvitationsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Returns the invitation and its one-time token (shown once, only a hash is stored). */
  async inviteStaff(
    workspaceId: string,
    input: { phone: string; role: StaffRole },
    actor: Actor,
  ): Promise<{ invitation: InvitationView; token: string }> {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new AppError(400, 'invalid_phone', 'Phone number is not valid');
    const token = randomBytes(24).toString('base64url');
    const now = this.clock.now();
    const id = this.ids.newId();
    const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
    await this.db.inWorkspace(workspaceId, async (tx) => {
      // A new invitation for the same number replaces older pending ones.
      await tx
        .update(workspaceInvitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(workspaceInvitations.phoneE164, phone),
            inArray(workspaceInvitations.role, ['class_teacher', 'assistant']),
            isNull(workspaceInvitations.acceptedAt),
            isNull(workspaceInvitations.revokedAt),
          ),
        );
      await tx.insert(workspaceInvitations).values({
        workspaceId,
        id,
        phoneE164: phone,
        role: input.role,
        tokenHash: hashToken(token),
        invitedBy: actor.userId,
        createdAt: now,
        expiresAt,
      });
      await this.audit.record(tx, {
        action: 'invitation.created',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'invitation', id },
        newValue: { role: input.role },
        requestId: actor.requestId,
      });
    });
    return {
      invitation: {
        id,
        phoneE164: phone,
        role: input.role,
        createdAt: now,
        expiresAt,
        status: 'pending',
      },
      token,
    };
  }

  async list(workspaceId: string): Promise<InvitationView[]> {
    const now = this.clock.now();
    const rows = await this.db.inWorkspace(workspaceId, (tx) =>
      tx
        .select()
        .from(workspaceInvitations)
        .where(inArray(workspaceInvitations.role, ['class_teacher', 'assistant']))
        .orderBy(desc(workspaceInvitations.createdAt))
        .limit(50),
    );
    return rows.map((row) => ({
      id: row.id,
      phoneE164: row.phoneE164,
      role: row.role as StaffRole,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      status: row.acceptedAt
        ? 'accepted'
        : row.revokedAt
          ? 'revoked'
          : row.expiresAt <= now
            ? 'expired'
            : 'pending',
    }));
  }

  async revoke(workspaceId: string, invitationId: string, actor: Actor): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const revoked = await tx
        .update(workspaceInvitations)
        .set({ revokedAt: this.clock.now() })
        .where(
          and(
            eq(workspaceInvitations.id, invitationId),
            isNull(workspaceInvitations.acceptedAt),
            isNull(workspaceInvitations.revokedAt),
          ),
        )
        .returning({ id: workspaceInvitations.id });
      if (revoked.length === 0) throw notFound('Invitation not found');
      await this.audit.record(tx, {
        action: 'invitation.revoked',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'invitation', id: invitationId },
        requestId: actor.requestId,
      });
    });
  }

  /** What the invitee sees before accepting: the workspace and role, if the token is valid. */
  async preview(
    workspaceId: string,
    token: string,
  ): Promise<{ workspaceName: string; role: StaffRole }> {
    if (!isUuid(workspaceId)) throw invalidInvitation();
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const invitation = await this.findUsable(tx, token);
      const [workspace] = await tx
        .select({ name: workspaces.name })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
      return { workspaceName: workspace?.name ?? '', role: invitation.role as StaffRole };
    });
  }

  /**
   * Accepts with the signed-in account. The account's verified phone must be the invited number,
   * so a forwarded link is useless to anyone else.
   */
  async accept(workspaceId: string, token: string, userId: string): Promise<string> {
    if (!isUuid(workspaceId)) throw invalidInvitation();
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const invitation = await this.findUsable(tx, token);
      const [user] = await tx
        .select({ phone: users.phoneE164, verifiedAt: users.phoneVerifiedAt, status: users.status })
        .from(users)
        .where(eq(users.id, userId));
      if (
        !user ||
        user.status !== 'active' ||
        !user.verifiedAt ||
        user.phone !== invitation.phoneE164
      ) {
        throw new AppError(403, 'invitation_phone_mismatch', 'Sign in with the invited number');
      }
      const now = this.clock.now();
      const [existing] = await tx
        .select({ id: memberships.id, status: memberships.status })
        .from(memberships)
        .where(eq(memberships.userId, userId));
      let membershipId: string;
      if (existing && existing.status !== 'removed') {
        throw new AppError(409, 'already_member', 'Already a member of this workspace');
      } else if (existing) {
        // A returning staff member keeps their history (BIZ-11).
        membershipId = existing.id;
        await tx
          .update(memberships)
          .set({ role: invitation.role, status: 'active', updatedAt: now })
          .where(eq(memberships.id, existing.id));
      } else {
        membershipId = this.ids.newId();
        await tx.insert(memberships).values({
          workspaceId,
          id: membershipId,
          userId,
          role: invitation.role,
          status: 'active',
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
      }
      await tx
        .update(workspaceInvitations)
        .set({ acceptedAt: now, acceptedBy: userId, membershipId })
        .where(eq(workspaceInvitations.id, invitation.id));
      await this.audit.record(tx, {
        action: 'invitation.accepted',
        workspaceId,
        actor: { type: 'user', userId },
        entity: { type: 'membership', id: membershipId },
        newValue: { role: invitation.role },
      });
      const [workspace] = await tx
        .select({ ownerUserId: workspaces.ownerUserId })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
      if (workspace) {
        await this.notifications.notify(tx, {
          recipientUserId: workspace.ownerUserId,
          workspaceId,
          type: 'staff.joined',
          params: { role: invitation.role },
          link: `/w/${workspaceId}/staff`,
        });
      }
      return membershipId;
    });
  }

  private async findUsable(
    tx: Parameters<Parameters<TenantDb['transaction']>[0]>[0],
    token: string,
  ) {
    const [invitation] = await tx
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.tokenHash, hashToken(token)))
      .for('update');
    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt <= this.clock.now()
    ) {
      throw invalidInvitation();
    }
    return invitation;
  }
}

function invalidInvitation(): AppError {
  return new AppError(404, 'invitation_invalid', 'This invitation is invalid or has expired');
}
