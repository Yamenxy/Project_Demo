import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { Clock } from '../../common';
import { TenantDb } from '../../database';
import { AttemptsService, HomeworkService } from '../assessment';
import { AuditService } from '../audit';
import { AttendanceService } from '../classes';
import { GradingService } from '../grading';
import { users } from '../identity';
import { LedgerService, PaymentRequestsService } from '../payments';
import { MembershipsService, PermissionsService, type WorkspaceContext } from '../tenancy';

export interface Actor {
  userId: string;
  requestId?: string;
}

/**
 * "Download my data" (REQ-PRIV-003): the account, and in each workspace where the person is a
 * student, their own records as the app shows them to them (the same services as the student
 * screens, so unreleased grades and hidden answers stay out). Only the requester's data.
 */
@Injectable()
export class PrivacyService {
  constructor(
    private readonly db: TenantDb,
    private readonly memberships: MembershipsService,
    private readonly permissions: PermissionsService,
    private readonly grading: GradingService,
    private readonly attendance: AttendanceService,
    private readonly ledger: LedgerService,
    private readonly requests: PaymentRequestsService,
    private readonly attempts: AttemptsService,
    private readonly homework: HomeworkService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async export(actor: Actor): Promise<Record<string, unknown>> {
    const [account] = await this.db.transaction((tx) =>
      tx
        .select({
          id: users.id,
          platformCode: users.platformCode,
          nameAr: users.nameAr,
          nameLatin: users.nameLatin,
          phone: users.phoneE164,
          email: users.email,
          dateOfBirth: users.dateOfBirth,
          guardianPhone: users.guardianPhoneE164,
          guardianConsentAt: users.guardianConsentAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, actor.userId)),
    );
    const workspaces = [];
    for (const w of await this.memberships.listForUser(actor.userId)) {
      const entry: Record<string, unknown> = { workspace: w.name, role: w.role, status: w.status };
      const ctx = await this.studentContext(w.workspaceId, actor.userId);
      if (ctx) {
        entry.grades = await this.grading.mine(ctx);
        entry.attendance = await this.attendance.mine(ctx);
        entry.payments = await this.ledger.mine(ctx);
        entry.paymentRequests = await this.requests.mine(ctx);
        entry.exams = await this.attempts.myExams(ctx);
        entry.homework = await this.homework.mine(ctx);
      }
      workspaces.push(entry);
    }
    await this.db.transaction((tx) =>
      this.audit.record(tx, {
        action: 'account.data_exported',
        workspaceId: null,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'user', id: actor.userId },
        newValue: { workspaces: workspaces.length },
        requestId: actor.requestId,
      }),
    );
    return { exportedAt: this.clock.now(), account, workspaces };
  }

  /** The person's student context in a workspace, as the access guard would build it. */
  private async studentContext(
    workspaceId: string,
    userId: string,
  ): Promise<WorkspaceContext | null> {
    return this.db.inWorkspace(workspaceId, async (tx) => {
      const membership = await this.memberships.resolve(tx, workspaceId, userId);
      if (membership?.role !== 'student') return null;
      const permissions = await this.permissions.forMembership(
        tx,
        membership.membershipId,
        membership.role,
      );
      return { ...membership, permissions };
    });
  }
}
