import { Injectable } from '@nestjs/common';
import { AppError, notFound } from '../../common';
import { TenantDb } from '../../database';
import { AuditService } from '../audit';
import { AttendanceService } from '../classes';
import { GradingService } from '../grading';
import { CashService, LedgerService } from '../payments';
import type { WorkspaceContext } from '../tenancy';
import { toCsv, type Cell } from './csv';
import { HEADERS, type Lang } from './headers';

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface CsvFile {
  name: string;
  body: string;
}

const money = (piastres: number) => (piastres / 100).toFixed(2);

function cairo(date: Date): string {
  // "2026-10-01 14:05", in Cairo time, for spreadsheets.
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Africa/Cairo',
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

/**
 * CSV exports (REQ-REPORT-001, `data.export`). Each reuses the screen's own service, so an export
 * shows exactly what the caller could see there, and every export is audited.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: TenantDb,
    private readonly grading: GradingService,
    private readonly attendanceService: AttendanceService,
    private readonly ledger: LedgerService,
    private readonly cash: CashService,
    private readonly audit: AuditService,
  ) {}

  async gradebook(
    ctx: WorkspaceContext,
    classId: string,
    lang: Lang,
    actor: Actor,
  ): Promise<CsvFile> {
    this.requireClass(ctx, classId);
    const book = await this.grading.gradebook(ctx, classId);
    const h = HEADERS[lang];
    const header = [
      h.student,
      ...book.items.map((i) => `${i.title} (${String(i.maxScore)})`),
      h.average,
    ];
    const rows: Cell[][] = book.students.map((s) => [
      s.name,
      ...book.items.map((i) => s.scores[i.id] ?? null),
      s.average === null ? null : Math.round(s.average * 10) / 10,
    ]);
    await this.record(ctx, actor, 'gradebook', rows.length, { classId });
    return { name: `gradebook-${book.className}.csv`, body: toCsv(header, rows) };
  }

  async attendance(
    ctx: WorkspaceContext,
    classId: string,
    lang: Lang,
    actor: Actor,
  ): Promise<CsvFile> {
    this.requireClass(ctx, classId);
    const summary = await this.attendanceService.classSummary(ctx, classId);
    const h = HEADERS[lang];
    const rows: Cell[][] = summary.map((r) => [
      r.name,
      r.present,
      r.late,
      r.absent,
      r.excused,
      r.rate === null ? null : Math.round(r.rate * 1000) / 10,
    ]);
    await this.record(ctx, actor, 'attendance', rows.length, { classId });
    return {
      name: 'attendance.csv',
      body: toCsv([h.student, h.present, h.late, h.absent, h.excused, h.ratePercent], rows),
    };
  }

  /** Every payment and reversal in the period; payment records are workspace-wide exports. */
  async payments(
    ctx: WorkspaceContext,
    period: { from: Date; to: Date },
    lang: Lang,
    actor: Actor,
  ): Promise<CsvFile> {
    this.requireEverywhere(ctx);
    const entries = await this.ledger.list(ctx, period);
    const h = HEADERS[lang];
    const rows: Cell[][] = entries.map((e) => [
      e.receiptNumber,
      cairo(e.recordedAt),
      e.studentName,
      e.kind === 'payment' ? money(e.amountPiastres) : money(-e.amountPiastres),
      e.currency,
      h.methods[e.method],
      e.itemName,
      e.collectedBy?.name ?? null,
      e.kind === 'payment' ? h.payment : h.reversal,
      e.note,
    ]);
    await this.record(ctx, actor, 'payments', rows.length, {
      from: period.from.toISOString(),
      to: period.to.toISOString(),
    });
    return {
      name: 'payments.csv',
      body: toCsv(
        [
          h.receipt,
          h.date,
          h.student,
          h.amount,
          h.currency,
          h.method,
          h.item,
          h.collector,
          h.kind,
          h.note,
        ],
        rows,
      ),
    };
  }

  /** The cash report per collector for one day, with the day's handovers (REQ-REPORT-002). */
  async cashDay(ctx: WorkspaceContext, date: string, lang: Lang, actor: Actor): Promise<CsvFile> {
    this.requireEverywhere(ctx);
    if (!ctx.permissions.has('finance.view')) throw new AppError(403, 'forbidden', 'Not allowed');
    const day = await this.cash.day(ctx.workspaceId, date);
    const h = HEADERS[lang];
    const rows: Cell[][] = day.map((d) => [
      d.name,
      d.payments,
      money(d.collectedPiastres),
      money(d.handedConfirmedPiastres),
      money(d.handedPendingPiastres),
      money(d.handedRejectedPiastres),
    ]);
    await this.record(ctx, actor, 'cash_day', rows.length, { date });
    return {
      name: `cash-${date}.csv`,
      body: toCsv(
        [
          h.collector,
          h.payments,
          h.collected,
          h.handedConfirmed,
          h.handedPending,
          h.handedRejected,
        ],
        rows,
      ),
    };
  }

  private requireClass(ctx: WorkspaceContext, classId: string): void {
    // A class outside the export scope is "not found", like everywhere else.
    if (!ctx.permissions.coversClass('data.export', classId)) throw notFound('Class not found');
  }

  private requireEverywhere(ctx: WorkspaceContext): void {
    if (!ctx.permissions.hasEverywhere('data.export')) {
      throw new AppError(403, 'forbidden', 'Not allowed');
    }
  }

  private async record(
    ctx: WorkspaceContext,
    actor: Actor,
    report: string,
    rows: number,
    details: Record<string, unknown>,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, (tx) =>
      this.audit.record(tx, {
        action: 'data.exported',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'workspace', id: ctx.workspaceId },
        newValue: { report, rows, ...details },
        requestId: actor.requestId,
      }),
    );
  }
}
