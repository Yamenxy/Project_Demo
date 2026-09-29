import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { normalizePhone } from '@lms/shared';
import {
  and,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { isUniqueViolation, TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { ConsentService, consentState, users, type ConsentState } from '../identity';
import { NotificationsService } from '../notify';
import { generateJoinCode } from './join-code';
import {
  memberships,
  workspaceInvitations,
  workspaces,
  workspaceSettings,
  type MembershipStatus,
} from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface StudentRow {
  membershipId: string;
  userId: string | null;
  name: string;
  /** Present only for viewers allowed to see phone numbers (REQ-PRIV-005). */
  phoneE164?: string;
  platformCode: string | null;
  internalCode: string | null;
  status: MembershipStatus;
  paused: boolean;
  managed: boolean;
  joinedAt: Date;
  /** Guardian consent (REQ-PRIV-001); null for managed records. The date of birth isn't shown. */
  consent: ConsentState | null;
}

export interface StudentSummary {
  active: number;
  pending: number;
  /** Records the teacher made that no student has taken over yet. */
  managed: number;
  missingConsent: number;
}

export interface JoinResult {
  workspaceId: string;
  workspaceName: string;
  status: MembershipStatus;
}

const CLAIM_TTL_MS = 30 * 24 * 3600 * 1000;
const PAGE_SIZE = 50;

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Students of a workspace (D8, REQ-USER-003, REQ-USER-006): joining by code or public page,
 * approval, managed records and their claim links, removal, and the joining settings.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly consent: ConsentService,
  ) {}

  /**
   * A signed-in, verified user asks to join by code or public slug. Pending until approved,
   * unless the workspace auto-approves. Asking again is harmless.
   */
  async join(userId: string, target: { code?: string; slug?: string }): Promise<JoinResult> {
    const found = await this.db.transaction((tx) =>
      tx.execute<{ workspace_id: string; name: string; auto_approve: boolean; suspended: boolean }>(
        sql`select * from app.workspace_join_target(${target.code ?? null}, ${target.slug ?? null})`,
      ),
    );
    const workspace = found.rows[0];
    if (!workspace || workspace.suspended) {
      throw new AppError(404, 'join_code_invalid', 'No workspace matches this code');
    }
    const workspaceId = workspace.workspace_id;
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const now = this.clock.now();
      const [existing] = await tx
        .select({ id: memberships.id, role: memberships.role, status: memberships.status })
        .from(memberships)
        .where(eq(memberships.userId, userId))
        .for('update');
      if (existing && existing.role !== 'student') {
        throw new AppError(409, 'already_member', 'Already a member of this workspace');
      }
      if (existing && existing.status !== 'removed') {
        return { workspaceId, workspaceName: workspace.name, status: existing.status };
      }
      if (!existing) {
        const claimed = await this.claimManagedByPhone(tx, workspaceId, userId);
        if (claimed) return { workspaceId, workspaceName: workspace.name, status: 'active' };
      }
      const status: MembershipStatus = workspace.auto_approve ? 'active' : 'pending';
      let membershipId: string;
      if (existing) {
        membershipId = existing.id;
        await tx
          .update(memberships)
          .set({ status, updatedAt: now })
          .where(eq(memberships.id, existing.id));
      } else {
        membershipId = this.ids.newId();
        await tx.insert(memberships).values({
          workspaceId,
          id: membershipId,
          userId,
          role: 'student',
          status,
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
      }
      await this.audit.record(tx, {
        action: status === 'active' ? 'student.joined' : 'student.join_requested',
        workspaceId,
        actor: { type: 'user', userId },
        entity: { type: 'membership', id: membershipId },
      });
      const [owner] = await tx
        .select({ ownerUserId: workspaces.ownerUserId })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));
      if (owner && status === 'pending') {
        await this.notifications.notify(tx, {
          recipientUserId: owner.ownerUserId,
          workspaceId,
          type: 'student.join_requested',
          link: `/w/${workspaceId}/students?status=pending`,
        });
      }
      return { workspaceId, workspaceName: workspace.name, status };
    });
  }

  /**
   * A student record the teacher already made (by hand or by import) for this user's verified
   * phone becomes theirs when they join: the teacher added them, so no approval is needed, and
   * the record keeps its history (REQ-USER-002, REQ-USER-003).
   */
  private async claimManagedByPhone(
    tx: DbTx,
    workspaceId: string,
    userId: string,
  ): Promise<boolean> {
    const [user] = await tx
      .select({ phone: users.phoneE164, verifiedAt: users.phoneVerifiedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!user?.phone || !user.verifiedAt) return false;
    // Serializes with imports, so the record can't be created twice meanwhile.
    await tx.select({ id: workspaceSettings.workspaceId }).from(workspaceSettings).for('update');
    const [record] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          isNull(memberships.userId),
          eq(memberships.provisionalPhone, user.phone),
          eq(memberships.status, 'active'),
        ),
      )
      .orderBy(memberships.createdAt)
      .limit(1)
      .for('update');
    if (!record) return false;
    const now = this.clock.now();
    await tx
      .update(memberships)
      .set({ userId, status: 'active', updatedAt: now })
      .where(eq(memberships.id, record.id));
    await tx
      .update(workspaceInvitations)
      .set({ revokedAt: now })
      .where(
        and(
          eq(workspaceInvitations.membershipId, record.id),
          isNull(workspaceInvitations.acceptedAt),
          isNull(workspaceInvitations.revokedAt),
        ),
      );
    await this.audit.record(tx, {
      action: 'student.claimed',
      workspaceId,
      actor: { type: 'user', userId },
      entity: { type: 'membership', id: record.id },
      newValue: { via: 'join' },
    });
    return true;
  }

  async list(
    workspaceId: string,
    options: {
      status?: MembershipStatus;
      query?: string;
      missingConsent?: boolean;
      showPhones: boolean;
      /** Staff limited to some classes see only students enrolled in them (REQ-RBAC-001). */
      classIds?: ReadonlySet<string>;
    },
  ): Promise<{ students: StudentRow[]; pendingCount: number; missingConsentCount: number }> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const filters: SQL[] = [eq(memberships.role, 'student')];
      filters.push(
        options.status
          ? eq(memberships.status, options.status)
          : inArray(memberships.status, ['active', 'pending', 'suspended']),
      );
      const now = this.clock.now();
      const missingConsent = this.missingConsentFilter(now);
      if (options.missingConsent) filters.push(missingConsent);
      if (options.classIds) {
        const ids = [...options.classIds];
        filters.push(
          ids.length === 0
            ? sql`false`
            : sql`exists (select 1 from class_enrollments ce
                where ce.membership_id = ${memberships.id} and ce.ended_at is null
                  and ce.class_id in ${ids})`,
        );
      }
      const q = options.query?.trim();
      if (q) {
        const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
        const phone = normalizePhone(q);
        const matchers = [
          ilike(users.nameAr, like),
          ilike(memberships.provisionalName, like),
          ilike(memberships.internalCode, like),
          ilike(users.platformCode, like),
        ];
        if (phone) {
          matchers.push(eq(users.phoneE164, phone), eq(memberships.provisionalPhone, phone));
        }
        const match = or(...matchers);
        if (match) filters.push(match);
      }
      const rows = await tx
        .select({
          membershipId: memberships.id,
          userId: memberships.userId,
          name: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`,
          phoneE164: sql<string>`coalesce(${users.phoneE164}, ${memberships.provisionalPhone})`,
          platformCode: users.platformCode,
          internalCode: memberships.internalCode,
          status: memberships.status,
          pausedAt: memberships.pausedAt,
          createdAt: memberships.createdAt,
          dateOfBirth: users.dateOfBirth,
          userCreatedAt: users.createdAt,
          guardianConsentAt: users.guardianConsentAt,
        })
        .from(memberships)
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(and(...filters))
        .orderBy(desc(memberships.createdAt))
        .limit(PAGE_SIZE);
      const [pending] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(memberships)
        .where(and(eq(memberships.role, 'student'), eq(memberships.status, 'pending')));
      const [missing] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.role, 'student'),
            inArray(memberships.status, ['active', 'pending', 'suspended']),
            missingConsent,
          ),
        );
      return {
        students: rows.map((row) => ({
          membershipId: row.membershipId,
          userId: row.userId,
          name: row.name,
          ...(options.showPhones ? { phoneE164: row.phoneE164 } : {}),
          platformCode: row.platformCode,
          internalCode: row.internalCode,
          status: row.status,
          paused: row.pausedAt !== null,
          managed: row.userId === null,
          joinedAt: row.createdAt,
          consent: row.userCreatedAt
            ? consentState(
                {
                  dateOfBirth: row.dateOfBirth,
                  createdAt: row.userCreatedAt,
                  consentAt: row.guardianConsentAt,
                },
                now,
              )
            : null,
        })),
        pendingCount: pending?.n ?? 0,
        missingConsentCount: missing?.n ?? 0,
      };
    });
  }

  /** Counts for the staff home screen. */
  async summary(workspaceId: string): Promise<StudentSummary> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const [row] = await tx
        .select({
          active: sql<number>`count(*) filter (where ${memberships.status} = 'active')::int`,
          pending: sql<number>`count(*) filter (where ${memberships.status} = 'pending')::int`,
          managed: sql<number>`count(*) filter (where ${memberships.userId} is null and ${memberships.status} = 'active')::int`,
          missingConsent: sql<number>`count(*) filter (where ${this.missingConsentFilter(this.clock.now())})::int`,
        })
        .from(memberships)
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.role, 'student'),
            inArray(memberships.status, ['active', 'pending', 'suspended']),
          ),
        );
      return row ?? { active: 0, pending: 0, managed: 0, missingConsent: 0 };
    });
  }

  /** Students with an account, under 18 or of unknown age, and no guardian consent yet. */
  private missingConsentFilter(now: Date): SQL {
    const cutoff = `${String(now.getUTCFullYear() - 18)}-${now.toISOString().slice(5, 10)}`;
    return and(
      isNotNull(memberships.userId),
      isNull(users.guardianConsentAt),
      or(isNull(users.dateOfBirth), gt(users.dateOfBirth, cutoff)),
    ) as SQL;
  }

  /** Staff saw a signed paper consent form for this student (REQ-PRIV-001). */
  async recordPaperConsent(
    workspaceId: string,
    membershipId: string,
    note: string | null,
    actor: Actor,
  ): Promise<void> {
    const [member] = await this.db.inWorkspace(workspaceId, (tx) =>
      tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.role, 'student'),
            isNotNull(memberships.userId),
            inArray(memberships.status, ['active', 'pending', 'suspended']),
          ),
        ),
    );
    if (!member?.userId) throw notFound('Student not found');
    await this.consent.recordPaper({
      userId: member.userId,
      workspaceId,
      recordedBy: actor.userId,
      note,
      requestId: actor.requestId,
    });
  }

  async decide(
    workspaceId: string,
    membershipId: string,
    approve: boolean,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const [updated] = await tx
        .update(memberships)
        .set({ status: approve ? 'active' : 'removed', updatedAt: this.clock.now() })
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.role, 'student'),
            eq(memberships.status, 'pending'),
          ),
        )
        .returning({ userId: memberships.userId });
      if (!updated) throw notFound('Join request not found');
      await this.audit.record(tx, {
        action: approve ? 'student.join_approved' : 'student.join_rejected',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        requestId: actor.requestId,
      });
      if (updated.userId && approve) {
        await this.notifications.notify(tx, {
          recipientUserId: updated.userId,
          workspaceId,
          type: 'student.join_approved',
          link: `/w/${workspaceId}`,
        });
      }
    });
  }

  /** Owner removes a student from the workspace, with a reason (Appendix A.3). */
  async remove(
    workspaceId: string,
    membershipId: string,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const removed = await tx
        .update(memberships)
        .set({ status: 'removed', updatedAt: this.clock.now() })
        .where(
          and(
            eq(memberships.id, membershipId),
            eq(memberships.role, 'student'),
            inArray(memberships.status, ['active', 'pending', 'suspended']),
          ),
        )
        .returning({ id: memberships.id });
      if (removed.length === 0) throw notFound('Student not found');
      await this.audit.record(tx, {
        action: 'student.removed',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        reason,
        requestId: actor.requestId,
      });
    });
  }

  /**
   * A student record created by staff, before the student has an account or joins (REQ-USER-003).
   * Returns a claim link: the student opens it signed in with that phone to take the record over.
   */
  async addManaged(
    workspaceId: string,
    input: { name: string; phone: string; internalCode?: string },
    actor: Actor,
  ): Promise<{ membershipId: string; token: string }> {
    const phone = normalizePhone(input.phone);
    if (!phone) throw new AppError(400, 'invalid_phone', 'Phone number is not valid');
    const token = randomBytes(24).toString('base64url');
    const membershipId = this.ids.newId();
    const now = this.clock.now();
    try {
      await this.db.inWorkspace(workspaceId, async (tx) => {
        await tx.insert(memberships).values({
          workspaceId,
          id: membershipId,
          userId: null,
          role: 'student',
          status: 'active',
          provisionalName: input.name.trim(),
          provisionalPhone: phone,
          internalCode: input.internalCode?.trim() || null,
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
        await tx.insert(workspaceInvitations).values({
          workspaceId,
          id: this.ids.newId(),
          phoneE164: phone,
          role: 'student',
          tokenHash: hashToken(token),
          invitedBy: actor.userId,
          membershipId,
          createdAt: now,
          expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
        });
        await this.audit.record(tx, {
          action: 'student.managed_created',
          workspaceId,
          actor: { type: 'user', userId: actor.userId },
          entity: { type: 'membership', id: membershipId },
          requestId: actor.requestId,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, 'memberships_internal_code_uq')) {
        throw new AppError(409, 'internal_code_taken', 'Another student has this code');
      }
      throw err;
    }
    return { membershipId, token };
  }

  /** Staff can't create a second claim link except by making a new one here. */
  async newClaimLink(workspaceId: string, membershipId: string, actor: Actor): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    const now = this.clock.now();
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const [member] = await tx
        .select({ phone: memberships.provisionalPhone })
        .from(memberships)
        .where(and(eq(memberships.id, membershipId), isNull(memberships.userId)));
      if (!member?.phone) throw notFound('Managed student not found');
      await tx
        .update(workspaceInvitations)
        .set({ revokedAt: now })
        .where(
          and(
            eq(workspaceInvitations.membershipId, membershipId),
            isNull(workspaceInvitations.acceptedAt),
            isNull(workspaceInvitations.revokedAt),
          ),
        );
      await tx.insert(workspaceInvitations).values({
        workspaceId,
        id: this.ids.newId(),
        phoneE164: member.phone,
        role: 'student',
        tokenHash: hashToken(token),
        invitedBy: actor.userId,
        membershipId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
      });
    });
    return token;
  }

  async settings(workspaceId: string): Promise<{ joinCode: string; autoApproveJoins: boolean }> {
    const [row] = await this.db.inWorkspace(workspaceId, (tx) =>
      tx
        .select({
          joinCode: workspaceSettings.joinCode,
          autoApproveJoins: workspaceSettings.autoApproveJoins,
        })
        .from(workspaceSettings),
    );
    if (!row) throw notFound('Settings not found');
    return row;
  }

  async updateSettings(
    workspaceId: string,
    change: { rotateCode?: boolean; autoApproveJoins?: boolean },
    actor: Actor,
  ): Promise<{ joinCode: string; autoApproveJoins: boolean }> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const updated = await this.applySettings(tx, change);
      await this.audit.record(tx, {
        action: 'workspace.joining_changed',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'workspace', id: workspaceId },
        newValue: {
          rotatedCode: Boolean(change.rotateCode),
          autoApproveJoins: updated.autoApproveJoins,
        },
        requestId: actor.requestId,
      });
      return updated;
    });
  }

  private async applySettings(
    tx: DbTx,
    change: { rotateCode?: boolean; autoApproveJoins?: boolean },
  ): Promise<{ joinCode: string; autoApproveJoins: boolean }> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const [row] = await tx.transaction((sp) =>
          sp
            .update(workspaceSettings)
            .set({
              ...(change.rotateCode ? { joinCode: generateJoinCode() } : {}),
              ...(change.autoApproveJoins === undefined
                ? {}
                : { autoApproveJoins: change.autoApproveJoins }),
              updatedAt: this.clock.now(),
            })
            .returning({
              joinCode: workspaceSettings.joinCode,
              autoApproveJoins: workspaceSettings.autoApproveJoins,
            }),
        );
        if (!row) throw notFound('Settings not found');
        return row;
      } catch (err) {
        if (!isUniqueViolation(err, 'workspace_settings_join_code_key')) throw err;
      }
    }
    throw new Error('Could not allocate a unique join code');
  }
}
