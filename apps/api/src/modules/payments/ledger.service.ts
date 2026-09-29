import { Injectable } from '@nestjs/common';
import { and, desc, eq, gte, ilike, lt, or, sql, type SQL } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import type { PermissionKey } from '../../common/policy';
import { isUniqueViolation, TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { NotificationsService } from '../notify';
import { memberships, type WorkspaceContext } from '../tenancy';
import type { Actor } from './price-list.service';
import { paymentEntries, priceItems } from './schema';

export type PaymentMethod = 'cash' | 'transfer' | 'wallet' | 'other';

export interface LedgerEntry {
  id: string;
  receiptNumber: number;
  kind: 'payment' | 'reversal';
  membershipId: string;
  studentName: string;
  amountPiastres: number;
  currency: string;
  method: PaymentMethod;
  collectedBy: { userId: string; name: string } | null;
  itemName: string | null;
  note: string | null;
  reversesId: string | null;
  reversed: boolean;
  recordedAt: Date;
}

export interface RecordInput {
  membershipId: string;
  amountPiastres: number;
  method: PaymentMethod;
  priceItemId?: string;
  note?: string;
}

/**
 * Students the caller may act on for a key: everyone for a workspace-wide grant, otherwise
 * students enrolled in a covered class (REQ-RBAC-001). Expressed on `memberships.id`.
 */
export function studentScope(ctx: WorkspaceContext, key: PermissionKey): SQL | undefined {
  const scope = ctx.permissions.scopeOf(key);
  if (scope === 'all') return undefined;
  const ids = [...scope];
  if (ids.length === 0) return sql`false`;
  return sql`exists (select 1 from class_enrollments ce
    where ce.membership_id = ${memberships.id} and ce.ended_at is null and ce.class_id in ${ids})`;
}

/** The immutable Flow B ledger with gapless receipt numbers (REQ-PAY-003, -004, -007). */
@Injectable()
export class LedgerService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Staff record a payment they received. Effective at once; never changes access (OD-04). */
  async record(
    ctx: WorkspaceContext,
    input: RecordInput,
    actor: Actor,
  ): Promise<{ id: string; receiptNumber: number }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const student = await this.student(tx, ctx, input.membershipId, 'payments.record');
      return this.append(tx, ctx.workspaceId, student.userId, {
        ...input,
        kind: 'payment',
        collectedBy: input.method === 'cash' ? actor.userId : null,
        recordedBy: actor.userId,
        requestId: actor.requestId,
      });
    });
  }

  /**
   * Appends one entry inside the caller's transaction, taking the next receipt number from the
   * workspace counter (a row lock, so concurrent writers queue and numbers have no gaps).
   */
  async append(
    tx: DbTx,
    workspaceId: string,
    studentUserId: string | null,
    entry: RecordInput & {
      kind: 'payment' | 'reversal';
      collectedBy: string | null;
      recordedBy: string;
      reversesId?: string;
      paymentRequestId?: string;
      currency?: string;
      requestId?: string;
    },
  ): Promise<{ id: string; receiptNumber: number }> {
    let item: { name: string; amountPiastres: number } | undefined;
    if (entry.priceItemId) {
      [item] = await tx
        .select({ name: priceItems.name, amountPiastres: priceItems.amountPiastres })
        .from(priceItems)
        .where(eq(priceItems.id, entry.priceItemId));
      if (!item) throw notFound('Price item not found');
    }
    const counter = await tx.execute<{ last_number: number }>(sql`
      insert into receipt_counters (workspace_id, last_number) values (${workspaceId}, 1)
      on conflict (workspace_id)
        do update set last_number = receipt_counters.last_number + 1
      returning last_number`);
    const receiptNumber = Number(counter.rows[0]?.last_number);
    const id = this.ids.newId();
    const now = this.clock.now();
    await tx.insert(paymentEntries).values({
      workspaceId,
      id,
      membershipId: entry.membershipId,
      kind: entry.kind,
      amountPiastres: entry.amountPiastres,
      currency: entry.currency ?? 'EGP',
      method: entry.method,
      collectedBy: entry.collectedBy,
      priceItemId: entry.priceItemId ?? null,
      itemName: item?.name ?? null,
      itemPricePiastres: item?.amountPiastres ?? null,
      note: entry.note?.trim() || null,
      reversesId: entry.reversesId ?? null,
      requestId: entry.paymentRequestId ?? null,
      receiptNumber,
      recordedBy: entry.recordedBy,
      recordedAt: now,
    });
    await this.audit.record(tx, {
      action: entry.kind === 'payment' ? 'payment.recorded' : 'payment.reversed',
      workspaceId,
      actor: { type: 'user', userId: entry.recordedBy },
      entity: { type: 'payment', id },
      newValue: {
        receiptNumber,
        membershipId: entry.membershipId,
        amountPiastres: entry.amountPiastres,
        method: entry.method,
        ...(entry.reversesId ? { reversesId: entry.reversesId } : {}),
      },
      ...(entry.kind === 'reversal' && entry.note ? { reason: entry.note } : {}),
      requestId: entry.requestId,
    });
    if (studentUserId) {
      await this.notifications.notify(tx, {
        recipientUserId: studentUserId,
        workspaceId,
        type: entry.kind === 'payment' ? 'payment.recorded' : 'payment.reversed',
        params: { receiptNumber: String(receiptNumber) },
        link: `/w/${workspaceId}/payments/${id}`,
      });
    }
    return { id, receiptNumber };
  }

  /** A refund or correction: a new entry for the full amount; the original stays (REQ-PAY-007). */
  async reverse(
    ctx: WorkspaceContext,
    entryId: string,
    reason: string,
    actor: Actor,
  ): Promise<{ id: string; receiptNumber: number }> {
    try {
      return await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
        const [original] = await tx
          .select()
          .from(paymentEntries)
          .where(eq(paymentEntries.id, entryId));
        // No row lock (the ledger has no UPDATE privilege, which locks need): the unique
        // index on reverses_id lets only one reversal commit.
        if (!original) throw notFound('Payment not found');
        if (original.kind !== 'payment') {
          throw new AppError(409, 'not_reversible', 'A reversal cannot be reversed');
        }
        const [member] = await tx
          .select({ userId: memberships.userId })
          .from(memberships)
          .where(eq(memberships.id, original.membershipId));
        return this.append(tx, ctx.workspaceId, member?.userId ?? null, {
          kind: 'reversal',
          membershipId: original.membershipId,
          amountPiastres: original.amountPiastres,
          currency: original.currency,
          method: original.method,
          collectedBy: original.method === 'cash' ? actor.userId : null,
          recordedBy: actor.userId,
          reversesId: original.id,
          note: reason,
          requestId: actor.requestId,
        });
      });
    } catch (err) {
      if (isUniqueViolation(err, 'payment_entries_reverses_id_key')) {
        throw new AppError(409, 'already_reversed', 'This payment is already reversed');
      }
      throw err;
    }
  }

  /** Entries the caller may see (`payments.view`, scoped to their students). */
  async list(
    ctx: WorkspaceContext,
    filter: { membershipId?: string; from?: Date; to?: Date },
  ): Promise<LedgerEntry[]> {
    return this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.query(
        tx,
        and(
          studentScope(ctx, 'payments.view'),
          filter.membershipId ? eq(paymentEntries.membershipId, filter.membershipId) : undefined,
          filter.from ? gte(paymentEntries.recordedAt, filter.from) : undefined,
          filter.to ? lt(paymentEntries.recordedAt, filter.to) : undefined,
        ),
      ),
    );
  }

  /** A student's own entries and receipts (REQ-PAY-004). */
  async mine(ctx: WorkspaceContext): Promise<LedgerEntry[]> {
    return this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.query(tx, eq(paymentEntries.membershipId, ctx.membershipId)),
    );
  }

  /** One receipt: for staff who can see the student, or the student it belongs to. */
  async receipt(ctx: WorkspaceContext, entryId: string): Promise<LedgerEntry> {
    const scope =
      ctx.role === 'student'
        ? eq(paymentEntries.membershipId, ctx.membershipId)
        : ctx.permissions.has('payments.view')
          ? studentScope(ctx, 'payments.view')
          : sql`false`;
    const [entry] = await this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.query(tx, and(eq(paymentEntries.id, entryId), scope)),
    );
    if (!entry) throw notFound('Payment not found');
    return entry;
  }

  private async query(tx: DbTx, where: SQL | undefined): Promise<LedgerEntry[]> {
    const collector = sql<
      string | null
    >`(select name_ar from users c where c.id = ${paymentEntries.collectedBy})`;
    const rows = await tx
      .select({
        entry: paymentEntries,
        studentName: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`,
        collectorName: collector,
        reversed: sql<boolean>`exists (select 1 from payment_entries r where r.reverses_id = ${paymentEntries.id})`,
      })
      .from(paymentEntries)
      .innerJoin(memberships, eq(memberships.id, paymentEntries.membershipId))
      .leftJoin(users, eq(users.id, memberships.userId))
      .where(where)
      .orderBy(desc(paymentEntries.receiptNumber))
      .limit(500);
    return rows.map(({ entry, studentName, collectorName, reversed }) => ({
      id: entry.id,
      receiptNumber: entry.receiptNumber,
      kind: entry.kind,
      membershipId: entry.membershipId,
      studentName,
      amountPiastres: entry.amountPiastres,
      currency: entry.currency,
      method: entry.method,
      collectedBy: entry.collectedBy
        ? { userId: entry.collectedBy, name: collectorName ?? '' }
        : null,
      itemName: entry.itemName,
      note: entry.note,
      reversesId: entry.reversesId,
      reversed,
      recordedAt: entry.recordedAt,
    }));
  }

  /** Students to pay for: names and codes only, within the caller's `payments.record` scope. */
  async searchStudents(
    ctx: WorkspaceContext,
    query: string,
  ): Promise<
    {
      membershipId: string;
      name: string;
      platformCode: string | null;
      internalCode: string | null;
    }[]
  > {
    const like = `%${query.trim().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return this.db.inWorkspace(ctx.workspaceId, (tx) =>
      tx
        .select({
          membershipId: memberships.id,
          name: sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`,
          platformCode: users.platformCode,
          internalCode: memberships.internalCode,
        })
        .from(memberships)
        .leftJoin(users, eq(users.id, memberships.userId))
        .where(
          and(
            eq(memberships.role, 'student'),
            sql`${memberships.status} in ('active', 'suspended')`,
            or(
              ilike(users.nameAr, like),
              ilike(memberships.provisionalName, like),
              ilike(memberships.internalCode, like),
              ilike(users.platformCode, like),
            ),
            studentScope(ctx, 'payments.record'),
          ),
        )
        .orderBy(sql`2`)
        .limit(20),
    );
  }

  /** The student, if the caller may act on them for `key`; otherwise 404. */
  private async student(tx: DbTx, ctx: WorkspaceContext, membershipId: string, key: PermissionKey) {
    const [student] = await tx
      .select({ id: memberships.id, userId: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.id, membershipId),
          eq(memberships.role, 'student'),
          sql`${memberships.status} <> 'removed'`,
          studentScope(ctx, key),
        ),
      );
    if (!student) throw notFound('Student not found');
    return student;
  }
}
