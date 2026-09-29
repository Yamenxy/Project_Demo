import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { NotificationsService } from '../notify';
import { workspaces, type WorkspaceContext } from '../tenancy';
import type { Actor } from './price-list.service';
import { cashHandovers } from './schema';

export interface CollectorDay {
  userId: string;
  name: string;
  /** Cash taken that day, net of cash given back (reversals). */
  collectedPiastres: number;
  payments: number;
}

export interface CashBalance {
  userId: string;
  name: string;
  /** All cash collected, net of reversals, minus confirmed handovers. */
  holdingPiastres: number;
  pendingHandoverPiastres: number;
}

export interface Handover {
  id: string;
  handedBy: { userId: string; name: string };
  amountPiastres: number;
  note: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
  createdAt: Date;
}

export interface IncomeReport {
  from: string;
  to: string;
  byMethod: { method: string; paidPiastres: number; reversedPiastres: number; count: number }[];
  netPiastres: number;
}

/** Cash per collector, handovers to the owner, and income totals (REQ-PAY-003, REQ-PAY-007). */
@Injectable()
export class CashService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Per-collector cash on one Cairo calendar day. */
  async day(workspaceId: string, date: string): Promise<CollectorDay[]> {
    const rows = await this.db.inWorkspace(workspaceId, (tx) =>
      tx.execute<{ user_id: string; name: string; collected: string; payments: number }>(sql`
        select p.collected_by as user_id, u.name_ar as name,
               sum(case when p.kind = 'payment' then p.amount_piastres else -p.amount_piastres end)
                 as collected,
               count(*) filter (where p.kind = 'payment')::int as payments
          from payment_entries p
          join users u on u.id = p.collected_by
         where p.method = 'cash'
           and (p.recorded_at at time zone 'Africa/Cairo')::date = ${date}::date
         group by p.collected_by, u.name_ar
         order by u.name_ar`),
    );
    return rows.rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      collectedPiastres: Number(r.collected),
      payments: r.payments,
    }));
  }

  /** What each collector still holds: cash collected minus confirmed handovers. */
  async balances(workspaceId: string, onlyUserId?: string): Promise<CashBalance[]> {
    const rows = await this.db.inWorkspace(workspaceId, (tx) =>
      tx.execute<{
        user_id: string;
        name: string;
        collected: string;
        handed: string;
        pending: string;
      }>(sql`
        with collected as (
          select collected_by as user_id,
                 sum(case when kind = 'payment' then amount_piastres else -amount_piastres end) as total
            from payment_entries where method = 'cash' group by collected_by
        ), handed as (
          select handed_by as user_id,
                 sum(amount_piastres) filter (where status = 'confirmed') as confirmed,
                 sum(amount_piastres) filter (where status = 'pending') as pending
            from cash_handovers group by handed_by
        )
        select u.id as user_id, u.name_ar as name,
               coalesce(c.total, 0) as collected, coalesce(h.confirmed, 0) as handed,
               coalesce(h.pending, 0) as pending
          from collected c
          full join handed h on h.user_id = c.user_id
          join users u on u.id = coalesce(c.user_id, h.user_id)
         where ${onlyUserId ?? null}::uuid is null or u.id = ${onlyUserId ?? null}::uuid
         order by u.name_ar`),
    );
    return rows.rows.map((r) => ({
      userId: r.user_id,
      name: r.name,
      holdingPiastres: Number(r.collected) - Number(r.handed),
      pendingHandoverPiastres: Number(r.pending),
    }));
  }

  async handOver(
    ctx: WorkspaceContext,
    input: { amountPiastres: number; note?: string },
    actor: Actor,
  ): Promise<{ id: string }> {
    if (ctx.role === 'owner') {
      throw new AppError(400, 'owner_holds_cash', 'The owner keeps the cash; nothing to hand over');
    }
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const id = this.ids.newId();
      await tx.insert(cashHandovers).values({
        workspaceId: ctx.workspaceId,
        id,
        handedBy: actor.userId,
        amountPiastres: input.amountPiastres,
        note: input.note?.trim() || null,
        status: 'pending',
        createdAt: this.clock.now(),
      });
      await this.audit.record(tx, {
        action: 'cash.handed_over',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'cash_handover', id },
        newValue: { amountPiastres: input.amountPiastres },
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
          type: 'cash.handed_over',
          link: `/w/${ctx.workspaceId}/cash`,
        });
      }
      return { id };
    });
  }

  /** The owner confirms (or rejects) receiving the cash. */
  async decide(
    workspaceId: string,
    handoverId: string,
    confirm: boolean,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const updated = await tx
        .update(cashHandovers)
        .set({
          status: confirm ? 'confirmed' : 'rejected',
          decidedBy: actor.userId,
          decidedAt: this.clock.now(),
        })
        .where(and(eq(cashHandovers.id, handoverId), eq(cashHandovers.status, 'pending')))
        .returning({ id: cashHandovers.id });
      if (updated.length === 0) throw notFound('Pending handover not found');
      await this.audit.record(tx, {
        action: confirm ? 'cash.handover_confirmed' : 'cash.handover_rejected',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'cash_handover', id: handoverId },
        requestId: actor.requestId,
      });
    });
  }

  async handovers(workspaceId: string, onlyUserId?: string): Promise<Handover[]> {
    const rows = await this.db.inWorkspace(workspaceId, (tx) =>
      tx
        .select({ handover: cashHandovers, name: users.nameAr })
        .from(cashHandovers)
        .innerJoin(users, eq(users.id, cashHandovers.handedBy))
        .where(onlyUserId ? eq(cashHandovers.handedBy, onlyUserId) : undefined)
        .orderBy(desc(cashHandovers.createdAt))
        .limit(200),
    );
    return rows.map(({ handover: h, name }) => ({
      id: h.id,
      handedBy: { userId: h.handedBy, name },
      amountPiastres: h.amountPiastres,
      note: h.note,
      status: h.status,
      createdAt: h.createdAt,
    }));
  }

  /** Income between two Cairo dates (end exclusive), net of reversals (REQ-PAY-007). */
  async income(workspaceId: string, from: string, to: string): Promise<IncomeReport> {
    const rows = await this.db.inWorkspace(workspaceId, (tx) =>
      tx.execute<{ method: string; paid: string; reversed: string; count: number }>(sql`
        select method,
               coalesce(sum(amount_piastres) filter (where kind = 'payment'), 0) as paid,
               coalesce(sum(amount_piastres) filter (where kind = 'reversal'), 0) as reversed,
               count(*) filter (where kind = 'payment')::int as count
          from payment_entries
         where (recorded_at at time zone 'Africa/Cairo')::date >= ${from}::date
           and (recorded_at at time zone 'Africa/Cairo')::date < ${to}::date
         group by method
         order by method`),
    );
    const byMethod = rows.rows.map((r) => ({
      method: r.method,
      paidPiastres: Number(r.paid),
      reversedPiastres: Number(r.reversed),
      count: r.count,
    }));
    return {
      from,
      to,
      byMethod,
      netPiastres: byMethod.reduce((sum, m) => sum + m.paidPiastres - m.reversedPiastres, 0),
    };
  }
}
