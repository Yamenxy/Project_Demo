import { Injectable, Logger } from '@nestjs/common';
import { normalizePhone } from '@lms/shared';
import { and, count, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import type { DbTx } from '../../database';
import { PlatformDb } from '../../database/platform-db';
import { AuditService } from '../audit';
import { users } from '../identity';
import { NotificationsService } from '../notify';
import { memberships, workspaces, WorkspacesService, type MembershipRole } from '../tenancy';
import {
  dueReminder,
  extendPeriod,
  subscriptionStatus,
  TRIAL_DAYS,
  type SubscriptionStatus,
} from './billing-rules';
import {
  platformPayments,
  subscriptionReminders,
  subscriptions,
  type PaymentMethod,
  type Plan,
} from './schema';

export interface WorkspaceSummary {
  id: string;
  slug: string;
  name: string;
  ownerName: string;
  plan: Plan;
  periodEndsAt: Date;
  status: SubscriptionStatus;
  suspension: 'billing' | 'admin' | null;
  members: Partial<Record<MembershipRole, number>>;
}

export interface PaymentView {
  id: string;
  amountPiastres: number;
  currency: string;
  method: PaymentMethod;
  reference: string | null;
  paidOn: string;
  months: number;
  createdAt: Date;
}

export interface RecordPaymentInput {
  amountPiastres: number;
  method: PaymentMethod;
  reference?: string;
  paidOn: string;
  months: number;
  plan?: Plan;
  notes?: string;
}

export interface Actor {
  userId: string;
  requestId?: string;
}

const DAY = 24 * 3600 * 1000;

/**
 * The platform owners' console (review §3.2, §3.6): teachers' workspaces and their subscriptions
 * (Flow A, simplified per REQ-SUB-001). Cross-workspace, so it uses the platform handle.
 */
@Injectable()
export class PlatformService {
  private readonly logger = new Logger('Platform');

  constructor(
    private readonly platformDb: PlatformDb,
    private readonly workspacesService: WorkspacesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async list(): Promise<WorkspaceSummary[]> {
    return this.platformDb.run('platform console: list workspaces', async (tx) => {
      const rows = await tx
        .select({
          id: workspaces.id,
          slug: workspaces.slug,
          name: workspaces.name,
          ownerName: users.nameAr,
          suspension: workspaces.suspensionReason,
          plan: subscriptions.plan,
          periodEndsAt: subscriptions.periodEndsAt,
          graceDays: subscriptions.graceDays,
          paid: sql<boolean>`exists (select 1 from platform_payments p where p.workspace_id = ${workspaces.id})`,
        })
        .from(workspaces)
        .innerJoin(users, eq(users.id, workspaces.ownerUserId))
        .innerJoin(subscriptions, eq(subscriptions.workspaceId, workspaces.id))
        .orderBy(workspaces.name);
      const counts = await tx
        .select({ workspaceId: memberships.workspaceId, role: memberships.role, n: count() })
        .from(memberships)
        .where(sql`${memberships.status} <> 'removed'`)
        .groupBy(memberships.workspaceId, memberships.role);
      const now = this.clock.now();
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        ownerName: row.ownerName,
        plan: row.plan,
        periodEndsAt: row.periodEndsAt,
        status: subscriptionStatus(row.periodEndsAt, row.graceDays, row.paid, now),
        suspension: row.suspension,
        members: Object.fromEntries(
          counts.filter((c) => c.workspaceId === row.id).map((c) => [c.role, c.n]),
        ),
      }));
    });
  }

  async detail(workspaceId: string): Promise<WorkspaceSummary & { payments: PaymentView[] }> {
    const summary = (await this.list()).find((w) => w.id === workspaceId);
    if (!summary) throw notFound('Workspace not found');
    const payments = await this.platformDb.run('platform console: payments', (tx) =>
      tx
        .select()
        .from(platformPayments)
        .where(eq(platformPayments.workspaceId, workspaceId))
        .orderBy(desc(platformPayments.createdAt)),
    );
    return {
      ...summary,
      payments: payments.map((p) => ({
        id: p.id,
        amountPiastres: p.amountPiastres,
        currency: p.currency,
        method: p.method,
        reference: p.reference,
        paidOn: p.paidOn,
        months: p.months,
        createdAt: p.createdAt,
      })),
    };
  }

  /**
   * Sets up a teacher who has already registered and verified their phone: workspace, owner
   * membership and a 14-day trial, in one transaction.
   */
  async createWorkspace(
    input: { slug: string; name: string; ownerPhone: string; plan?: Plan },
    actor: Actor,
  ): Promise<string> {
    const phone = normalizePhone(input.ownerPhone);
    if (!phone) throw new AppError(400, 'invalid_phone', 'Phone number is not valid');
    const [owner] = await this.platformDb.run('platform console: find teacher', (tx) =>
      tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.phoneE164, phone), isNotNull(users.phoneVerifiedAt))),
    );
    if (!owner) {
      throw new AppError(404, 'teacher_not_found', 'No verified account has this phone number');
    }
    const now = this.clock.now();
    return this.workspacesService.create(
      { slug: input.slug, name: input.name, ownerUserId: owner.id },
      actor.userId,
      async (tx, workspaceId) => {
        await tx.insert(subscriptions).values({
          workspaceId,
          plan: input.plan ?? 'starter',
          periodEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY),
          graceDays: 7,
          createdAt: now,
          updatedAt: now,
        });
      },
    );
  }

  /**
   * Records a payment the owners received (cash, InstaPay, ...), extends the paid period and lifts
   * a billing suspension (payment clears only a billing suspension, REQ-USER-001).
   */
  async recordPayment(workspaceId: string, input: RecordPaymentInput, actor: Actor): Promise<Date> {
    return this.platformDb.run('platform console: record payment', async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.workspaceId, workspaceId))
        .for('update');
      if (!sub) throw notFound('Workspace not found');
      const now = this.clock.now();
      const periodEndsAt = extendPeriod(sub.periodEndsAt, input.months, now);
      await tx.insert(platformPayments).values({
        id: this.ids.newId(),
        workspaceId,
        amountPiastres: input.amountPiastres,
        currency: 'EGP',
        method: input.method,
        reference: input.reference ?? null,
        paidOn: input.paidOn,
        months: input.months,
        notes: input.notes ?? null,
        recordedBy: actor.userId,
        createdAt: now,
      });
      await tx
        .update(subscriptions)
        .set({ periodEndsAt, plan: input.plan ?? sub.plan, updatedAt: now })
        .where(eq(subscriptions.workspaceId, workspaceId));
      await tx
        .update(workspaces)
        .set({ suspendedAt: null, suspensionReason: null, updatedAt: now })
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.suspensionReason, 'billing')));
      await this.audit.record(tx, {
        action: 'subscription.payment_recorded',
        workspaceId,
        actor: { type: 'platform_owner', userId: actor.userId },
        entity: { type: 'workspace', id: workspaceId },
        oldValue: { periodEndsAt: sub.periodEndsAt.toISOString(), plan: sub.plan },
        newValue: {
          periodEndsAt: periodEndsAt.toISOString(),
          plan: input.plan ?? sub.plan,
          amountPiastres: input.amountPiastres,
          method: input.method,
          months: input.months,
        },
        requestId: actor.requestId,
      });
      await this.notifyOwner(tx, workspaceId, 'billing.payment_recorded', {
        until: periodEndsAt.toISOString(),
      });
      return periodEndsAt;
    });
  }

  /** Admin suspension (abuse, policy): payment doesn't lift it, only `restore`. */
  async suspend(workspaceId: string, note: string, actor: Actor): Promise<void> {
    await this.setAdminSuspension(workspaceId, true, note, actor);
  }

  async restore(workspaceId: string, note: string, actor: Actor): Promise<void> {
    await this.setAdminSuspension(workspaceId, false, note, actor);
    // If the subscription has lapsed meanwhile, billing suspension applies again.
    await this.checkSubscriptions(workspaceId);
  }

  /**
   * Daily job (and after restore): moves lapsed workspaces into billing suspension and sends the
   * teacher's reminders. Safe to run any number of times.
   */
  async checkSubscriptions(onlyWorkspaceId?: string): Promise<void> {
    const now = this.clock.now();
    await this.platformDb.run('subscription check', async (tx) => {
      const rows = await tx
        .select({
          workspaceId: subscriptions.workspaceId,
          periodEndsAt: subscriptions.periodEndsAt,
          graceDays: subscriptions.graceDays,
          suspension: workspaces.suspensionReason,
        })
        .from(subscriptions)
        .innerJoin(workspaces, eq(workspaces.id, subscriptions.workspaceId))
        .where(onlyWorkspaceId ? eq(subscriptions.workspaceId, onlyWorkspaceId) : undefined);
      for (const row of rows) {
        const status = subscriptionStatus(row.periodEndsAt, row.graceDays, true, now);
        if (status === 'lapsed' && row.suspension === null) {
          await tx
            .update(workspaces)
            .set({ suspendedAt: now, suspensionReason: 'billing', updatedAt: now })
            .where(eq(workspaces.id, row.workspaceId));
          await this.audit.record(tx, {
            action: 'workspace.suspended',
            workspaceId: row.workspaceId,
            actor: { type: 'system' },
            entity: { type: 'workspace', id: row.workspaceId },
            newValue: { reason: 'billing' },
          });
          await this.notifyOwner(tx, row.workspaceId, 'billing.workspace_suspended', {});
        }
        const kind = dueReminder(row.periodEndsAt, now);
        if (kind && status !== 'lapsed') {
          const [inserted] = await tx
            .insert(subscriptionReminders)
            .values({
              workspaceId: row.workspaceId,
              periodEndsAt: row.periodEndsAt,
              kind,
              sentAt: now,
            })
            .onConflictDoNothing()
            .returning({ kind: subscriptionReminders.kind });
          if (inserted) {
            await this.notifyOwner(tx, row.workspaceId, `billing.reminder_${kind}`, {
              until: row.periodEndsAt.toISOString(),
            });
          }
        }
      }
    });
  }

  private async setAdminSuspension(
    workspaceId: string,
    suspend: boolean,
    note: string,
    actor: Actor,
  ): Promise<void> {
    await this.platformDb.run('platform console: suspension', async (tx) => {
      const now = this.clock.now();
      const updated = await tx
        .update(workspaces)
        .set(
          suspend
            ? { suspendedAt: now, suspensionReason: 'admin', updatedAt: now }
            : { suspendedAt: null, suspensionReason: null, updatedAt: now },
        )
        .where(eq(workspaces.id, workspaceId))
        .returning({ id: workspaces.id });
      if (updated.length === 0) throw notFound('Workspace not found');
      await this.audit.record(tx, {
        action: suspend ? 'workspace.suspended' : 'workspace.restored',
        workspaceId,
        actor: { type: 'platform_owner', userId: actor.userId },
        entity: { type: 'workspace', id: workspaceId },
        newValue: suspend ? { reason: 'admin' } : {},
        reason: note,
        requestId: actor.requestId,
      });
    });
    this.logger.log({ event: suspend ? 'workspace_suspended' : 'workspace_restored', workspaceId });
  }

  private async notifyOwner(
    tx: DbTx,
    workspaceId: string,
    type: string,
    params: Record<string, string>,
  ): Promise<void> {
    const [workspace] = await tx
      .select({ ownerUserId: workspaces.ownerUserId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    if (!workspace) return;
    await this.notifications.notify(tx, {
      recipientUserId: workspace.ownerUserId,
      workspaceId,
      type,
      params,
      link: '/billing',
    });
  }
}
