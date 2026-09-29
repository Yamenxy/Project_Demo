import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { isUniqueViolation, TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { NotificationsService } from '../notify';
import { memberships, PermissionsService, workspaces, type WorkspaceContext } from '../tenancy';
import { LedgerService, studentScope } from './ledger.service';
import type { Actor } from './price-list.service';
import { paymentRequests } from './schema';

export interface RequestView {
  id: string;
  membershipId: string;
  studentName: string;
  amountPiastres: number;
  currency: string;
  method: 'transfer' | 'wallet' | 'other';
  reference: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  resubmitsId: string | null;
  rejectReason: string | null;
  /** Another request in the workspace used the same reference: flagged, never blocked. */
  duplicateReference: boolean;
  createdAt: Date;
}

export interface SubmitInput {
  amountPiastres: number;
  method: 'transfer' | 'wallet' | 'other';
  reference: string;
  note?: string;
  resubmitsId?: string;
}

/** Payment requests: submit, cancel, approve into the ledger, or reject (REQ-PAY-008, -010). */
@Injectable()
export class PaymentRequestsService {
  constructor(
    private readonly db: TenantDb,
    private readonly ledger: LedgerService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async submit(ctx: WorkspaceContext, input: SubmitInput, actor: Actor): Promise<{ id: string }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      if (input.resubmitsId) {
        const [previous] = await tx
          .select({ status: paymentRequests.status })
          .from(paymentRequests)
          .where(
            and(
              eq(paymentRequests.id, input.resubmitsId),
              eq(paymentRequests.membershipId, ctx.membershipId),
            ),
          );
        if (!previous) throw notFound('Request not found');
        if (previous.status !== 'rejected') {
          throw new AppError(409, 'not_rejected', 'Only a rejected request can be resubmitted');
        }
      }
      const id = this.ids.newId();
      const now = this.clock.now();
      await tx.insert(paymentRequests).values({
        workspaceId: ctx.workspaceId,
        id,
        membershipId: ctx.membershipId,
        submittedBy: actor.userId,
        amountPiastres: input.amountPiastres,
        method: input.method,
        reference: input.reference.trim(),
        note: input.note?.trim() || null,
        status: 'pending',
        resubmitsId: input.resubmitsId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.record(tx, {
        action: 'payment_request.submitted',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'payment_request', id },
        newValue: {
          amountPiastres: input.amountPiastres,
          method: input.method,
          ...(input.resubmitsId ? { resubmitsId: input.resubmitsId } : {}),
        },
        requestId: actor.requestId,
      });
      const [owner] = await tx
        .select({ userId: workspaces.ownerUserId })
        .from(workspaces)
        .where(eq(workspaces.id, ctx.workspaceId));
      if (owner) {
        await this.notifications.notify(tx, {
          recipientUserId: owner.userId,
          workspaceId: ctx.workspaceId,
          type: 'payment_request.submitted',
          link: `/w/${ctx.workspaceId}/payments?tab=requests`,
        });
      }
      return { id };
    });
  }

  async cancel(ctx: WorkspaceContext, requestId: string, actor: Actor): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const updated = await tx
        .update(paymentRequests)
        .set({ status: 'cancelled', updatedAt: this.clock.now() })
        .where(
          and(
            eq(paymentRequests.id, requestId),
            eq(paymentRequests.membershipId, ctx.membershipId),
            eq(paymentRequests.status, 'pending'),
          ),
        )
        .returning({ id: paymentRequests.id });
      if (updated.length === 0) throw notFound('Pending request not found');
      await this.audit.record(tx, {
        action: 'payment_request.cancelled',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'payment_request', id: requestId },
        requestId: actor.requestId,
      });
    });
  }

  /**
   * Approves into exactly one ledger entry and one receipt, even under concurrent approvals: the
   * request row is locked, its status re-checked, and the approver's permission and the
   * workspace state are read again inside the transaction (REQ-PAY-008).
   */
  async approve(
    ctx: WorkspaceContext,
    requestId: string,
    actor: Actor,
  ): Promise<{ receiptNumber: number; paymentId: string }> {
    try {
      return await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
        const request = await this.lockPending(tx, ctx, requestId);
        await this.recheck(tx, ctx, request.membershipId);
        if (request.submittedBy === actor.userId) {
          throw new AppError(403, 'own_request', 'You cannot approve your own request');
        }
        const now = this.clock.now();
        await tx
          .update(paymentRequests)
          .set({ status: 'approved', decidedBy: actor.userId, decidedAt: now, updatedAt: now })
          .where(eq(paymentRequests.id, requestId));
        const [member] = await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(eq(memberships.id, request.membershipId));
        const entry = await this.ledger.append(tx, ctx.workspaceId, member?.userId ?? null, {
          kind: 'payment',
          membershipId: request.membershipId,
          amountPiastres: request.amountPiastres,
          currency: request.currency,
          method: request.method,
          collectedBy: null,
          recordedBy: actor.userId,
          note: `${request.reference}${request.note ? ` — ${request.note}` : ''}`.slice(0, 300),
          paymentRequestId: requestId,
          requestId: actor.requestId,
        });
        await this.audit.record(tx, {
          action: 'payment_request.approved',
          workspaceId: ctx.workspaceId,
          actor: { type: 'user', userId: actor.userId },
          entity: { type: 'payment_request', id: requestId },
          newValue: { paymentId: entry.id, receiptNumber: entry.receiptNumber },
          requestId: actor.requestId,
        });
        return { receiptNumber: entry.receiptNumber, paymentId: entry.id };
      });
    } catch (err) {
      if (isUniqueViolation(err, 'payment_entries_request_id_key')) {
        throw new AppError(409, 'request_not_pending', 'This request was already decided');
      }
      throw err;
    }
  }

  async reject(
    ctx: WorkspaceContext,
    requestId: string,
    reason: string,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const request = await this.lockPending(tx, ctx, requestId);
      await this.recheck(tx, ctx, request.membershipId);
      const now = this.clock.now();
      await tx
        .update(paymentRequests)
        .set({
          status: 'rejected',
          rejectReason: reason,
          decidedBy: actor.userId,
          decidedAt: now,
          updatedAt: now,
        })
        .where(eq(paymentRequests.id, requestId));
      await this.audit.record(tx, {
        action: 'payment_request.rejected',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'payment_request', id: requestId },
        reason,
        requestId: actor.requestId,
      });
      const [member] = await tx
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(eq(memberships.id, request.membershipId));
      if (member?.userId) {
        await this.notifications.notify(tx, {
          recipientUserId: member.userId,
          workspaceId: ctx.workspaceId,
          type: 'payment_request.rejected',
          link: `/w/${ctx.workspaceId}/my-payments`,
        });
      }
    });
  }

  /** For staff with `payments.confirm`, scoped to their students. */
  async list(ctx: WorkspaceContext, status?: RequestView['status']): Promise<RequestView[]> {
    return this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.query(
        tx,
        and(
          studentScope(ctx, 'payments.confirm'),
          status ? eq(paymentRequests.status, status) : undefined,
        ),
      ),
    );
  }

  async mine(ctx: WorkspaceContext): Promise<RequestView[]> {
    return this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.query(tx, eq(paymentRequests.membershipId, ctx.membershipId)),
    );
  }

  private async query(tx: DbTx, where: SQL | undefined): Promise<RequestView[]> {
    const rows = await tx
      .select({
        request: paymentRequests,
        studentName: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`,
        duplicate: sql<boolean>`exists (select 1 from payment_requests o
          where o.id <> ${paymentRequests.id}
            and lower(o.reference) = lower(${paymentRequests.reference})
            and o.status <> 'cancelled')`,
      })
      .from(paymentRequests)
      .innerJoin(memberships, eq(memberships.id, paymentRequests.membershipId))
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(where)
      .orderBy(desc(paymentRequests.createdAt))
      .limit(300);
    return rows.map(({ request: r, studentName, duplicate }) => ({
      id: r.id,
      membershipId: r.membershipId,
      studentName,
      amountPiastres: r.amountPiastres,
      currency: r.currency,
      method: r.method,
      reference: r.reference,
      note: r.note,
      status: r.status,
      resubmitsId: r.resubmitsId,
      rejectReason: r.rejectReason,
      duplicateReference: duplicate,
      createdAt: r.createdAt,
    }));
  }

  private async lockPending(tx: DbTx, ctx: WorkspaceContext, requestId: string) {
    const [request] = await tx
      .select()
      .from(paymentRequests)
      .innerJoin(memberships, eq(memberships.id, paymentRequests.membershipId))
      .where(and(eq(paymentRequests.id, requestId), studentScope(ctx, 'payments.confirm')))
      .for('update', { of: paymentRequests });
    if (!request) throw notFound('Request not found');
    if (request.payment_requests.status !== 'pending') {
      throw new AppError(409, 'request_not_pending', 'This request was already decided');
    }
    return request.payment_requests;
  }

  /** Permission and workspace state, read again inside the transaction (REQ-PAY-008). */
  private async recheck(tx: DbTx, ctx: WorkspaceContext, membershipId: string): Promise<void> {
    const [workspace] = await tx
      .select({ suspendedAt: workspaces.suspendedAt })
      .from(workspaces)
      .where(eq(workspaces.id, ctx.workspaceId));
    if (!workspace || workspace.suspendedAt) {
      throw new AppError(403, 'workspace_suspended', 'This workspace is temporarily unavailable');
    }
    const [me] = await tx
      .select({ role: memberships.role, status: memberships.status })
      .from(memberships)
      .where(eq(memberships.id, ctx.membershipId));
    if (!me || me.status !== 'active') throw new AppError(403, 'forbidden', 'Not allowed');
    const fresh = await this.permissions.forMembership(tx, ctx.membershipId, me.role);
    const [inScope] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, membershipId),
          studentScope({ ...ctx, permissions: fresh }, 'payments.confirm'),
        ),
      );
    if (!fresh.has('payments.confirm') || !inScope) {
      throw new AppError(403, 'forbidden', 'Not allowed');
    }
  }
}
