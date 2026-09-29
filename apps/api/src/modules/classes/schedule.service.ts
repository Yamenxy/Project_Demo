import { Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { classEnrollments, classes } from './schema';
import {
  attendanceRecords,
  classSeries,
  classSessions,
  workspaceSkipDates,
} from './schedule-schema';
import type { WorkspaceContext } from '../tenancy';
import { classScope } from './classes.service';
import type { Actor } from './classes.service';

/** Sessions are generated this many days ahead, lazily, whenever a schedule is read. */
export const HORIZON_DAYS = 56;
export const DEFAULT_TIME_ZONE = 'Africa/Cairo';

export interface SessionView {
  id: string;
  classId: string;
  className: string;
  seriesId: string | null;
  localDate: string;
  startsAt: Date;
  endsAt: Date;
  cancelled: boolean;
  cancelReason: string | null;
}

export interface SeriesView {
  id: string;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  timeZone: string;
  startsOn: string;
  endsOn: string | null;
}

/** Another session of the same responsible teacher at the same time (REQ-SCHED-002). */
export interface OverlapWarning {
  className: string;
  startsAt: Date;
}

/**
 * Weekly schedules and sessions (REQ-SCHED-001, REQ-SCHED-002). Conversion from local wall-clock
 * time to UTC happens in PostgreSQL (`(date + time) AT TIME ZONE zone`), which applies Egypt's
 * daylight-saving rules for each date.
 */
@Injectable()
export class ScheduleService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /** Creates any missing sessions up to the horizon. Idempotent. */
  async generate(tx: DbTx): Promise<void> {
    const now = this.clock.now();
    await tx.execute(sql`
      insert into class_sessions
        (workspace_id, id, class_id, series_id, local_date, starts_at, ends_at, created_at)
      select s.workspace_id, gen_random_uuid(), s.class_id, s.id, d::date,
             (d::date + s.start_time) at time zone s.time_zone,
             (d::date + s.start_time) at time zone s.time_zone
               + make_interval(mins => s.duration_minutes),
             ${now}::timestamptz
        from class_series s
        join classes c on c.id = s.class_id and c.archived_at is null
        cross join lateral generate_series(
          greatest(s.starts_on, (${now}::timestamptz at time zone s.time_zone)::date),
          least(
            coalesce(s.ends_on, 'infinity'::date),
            (${now}::timestamptz at time zone s.time_zone)::date + ${HORIZON_DAYS}::int
          ),
          interval '1 day'
        ) as d
       where extract(dow from d) = s.weekday
         and not exists (select 1 from workspace_skip_dates k where k.skip_date = d::date)
      on conflict (series_id, local_date) where series_id is not null do nothing`);
  }

  async classSchedule(
    ctx: WorkspaceContext,
    classId: string,
  ): Promise<{ series: SeriesView[]; sessions: SessionView[] }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.visibleClass(tx, ctx, classId);
      await this.generate(tx);
      const series = await tx
        .select()
        .from(classSeries)
        .where(eq(classSeries.classId, classId))
        .orderBy(asc(classSeries.weekday), asc(classSeries.startTime));
      const now = this.clock.now();
      const sessions = await this.sessionsWhere(
        tx,
        and(eq(classSessions.classId, classId), gte(classSessions.endsAt, now)),
        30,
      );
      return {
        series: series.map((s) => ({
          id: s.id,
          weekday: s.weekday,
          startTime: s.startTime.slice(0, 5),
          durationMinutes: s.durationMinutes,
          timeZone: s.timeZone,
          startsOn: s.startsOn,
          endsOn: s.endsOn,
        })),
        sessions,
      };
    });
  }

  /** Sessions between two local dates for the caller: their classes as staff, or as a student. */
  async agenda(ctx: WorkspaceContext, from: string, to: string): Promise<SessionView[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.generate(tx);
      const range = and(gte(classSessions.localDate, from), lt(classSessions.localDate, to));
      if (ctx.role === 'student') {
        return this.sessionsWhere(
          tx,
          and(
            range,
            sql`exists (select 1 from ${classEnrollments}
              where ${classEnrollments.classId} = ${classSessions.classId}
                and ${classEnrollments.membershipId} = ${ctx.membershipId}
                and ${classEnrollments.endedAt} is null)`,
          ),
          500,
        );
      }
      return this.sessionsWhere(tx, and(range, classScope(ctx)), 500);
    });
  }

  async addSeries(
    ctx: WorkspaceContext,
    classId: string,
    input: {
      weekday: number;
      startTime: string;
      durationMinutes: number;
      startsOn: string;
      endsOn?: string;
    },
    actor: Actor,
  ): Promise<{ id: string; warnings: OverlapWarning[] }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.managedClass(tx, ctx, classId);
      const id = this.ids.newId();
      await tx.insert(classSeries).values({
        workspaceId: ctx.workspaceId,
        id,
        classId,
        weekday: input.weekday,
        startTime: input.startTime,
        durationMinutes: input.durationMinutes,
        timeZone: DEFAULT_TIME_ZONE,
        startsOn: input.startsOn,
        endsOn: input.endsOn ?? null,
        createdAt: this.clock.now(),
      });
      await this.generate(tx);
      await this.audit.record(tx, {
        action: 'schedule.series_created',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'class', id: classId },
        newValue: { seriesId: id, ...input },
        requestId: actor.requestId,
      });
      return { id, warnings: await this.overlaps(tx, sql`b.series_id = ${id}`) };
    });
  }

  /** Ends a series: no sessions after `endsOn`; future sessions already generated are removed. */
  async endSeries(
    ctx: WorkspaceContext,
    classId: string,
    seriesId: string,
    endsOn: string,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.managedClass(tx, ctx, classId);
      const [series] = await tx
        .update(classSeries)
        .set({ endsOn })
        .where(and(eq(classSeries.id, seriesId), eq(classSeries.classId, classId)))
        .returning({ startsOn: classSeries.startsOn });
      if (!series) throw notFound('Series not found');
      if (endsOn < series.startsOn) {
        throw new AppError(400, 'invalid_date', 'The end is before the start');
      }
      await this.removeFutureSessions(
        tx,
        and(eq(classSessions.seriesId, seriesId), sql`${classSessions.localDate} > ${endsOn}`),
      );
      await this.audit.record(tx, {
        action: 'schedule.series_ended',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'class', id: classId },
        newValue: { seriesId, endsOn },
        requestId: actor.requestId,
      });
    });
  }

  async addSession(
    ctx: WorkspaceContext,
    classId: string,
    input: { date: string; startTime: string; durationMinutes: number },
    actor: Actor,
  ): Promise<{ id: string; warnings: OverlapWarning[] }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.managedClass(tx, ctx, classId);
      const id = this.ids.newId();
      const now = this.clock.now();
      await tx.execute(sql`
        insert into class_sessions
          (workspace_id, id, class_id, local_date, starts_at, ends_at, created_at)
        values (${ctx.workspaceId}, ${id}, ${classId}, ${input.date}::date,
                (${input.date}::date + ${input.startTime}::time) at time zone ${DEFAULT_TIME_ZONE},
                (${input.date}::date + ${input.startTime}::time) at time zone ${DEFAULT_TIME_ZONE}
                  + make_interval(mins => ${input.durationMinutes}::int),
                ${now}::timestamptz)`);
      await this.audit.record(tx, {
        action: 'schedule.session_created',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'session', id },
        newValue: { classId, ...input },
        requestId: actor.requestId,
      });
      return { id, warnings: await this.overlaps(tx, sql`b.id = ${id}`) };
    });
  }

  async setCancelled(
    ctx: WorkspaceContext,
    sessionId: string,
    cancel: { reason: string; confirm?: boolean } | null,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [session] = await tx
        .select({ classId: classSessions.classId, cancelledAt: classSessions.cancelledAt })
        .from(classSessions)
        .where(eq(classSessions.id, sessionId))
        .for('update');
      if (!session) throw notFound('Session not found');
      await this.managedClass(tx, ctx, session.classId);
      // Records are kept and flagged; percentages leave the session out (REQ-ATT-002).
      if (cancel && !cancel.confirm && (await this.sessionsWithAttendance(tx, [sessionId])).size) {
        throw new AppError(
          409,
          'session_has_attendance',
          'Confirm to cancel a session with attendance',
        );
      }
      await tx
        .update(classSessions)
        .set(
          cancel
            ? { cancelledAt: this.clock.now(), cancelReason: cancel.reason }
            : { cancelledAt: null, cancelReason: null },
        )
        .where(eq(classSessions.id, sessionId));
      await this.audit.record(tx, {
        action: cancel ? 'schedule.session_cancelled' : 'schedule.session_restored',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'session', id: sessionId },
        ...(cancel
          ? { reason: cancel.reason, newValue: { confirmed: Boolean(cancel.confirm) } }
          : {}),
        requestId: actor.requestId,
      });
    });
  }

  async skipDates(workspaceId: string): Promise<{ date: string; reason: string | null }[]> {
    const rows = await this.db.inWorkspace(workspaceId, (tx) =>
      tx
        .select({ date: workspaceSkipDates.skipDate, reason: workspaceSkipDates.reason })
        .from(workspaceSkipDates)
        .orderBy(asc(workspaceSkipDates.skipDate)),
    );
    return rows;
  }

  /** A holiday: generated sessions on that day are removed, and none are generated. */
  async addSkipDate(
    workspaceId: string,
    input: { date: string; reason?: string },
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      await tx
        .insert(workspaceSkipDates)
        .values({
          workspaceId,
          skipDate: input.date,
          reason: input.reason?.trim() || null,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing();
      await this.removeFutureSessions(
        tx,
        and(isNotNull(classSessions.seriesId), eq(classSessions.localDate, input.date)),
      );
      await this.audit.record(tx, {
        action: 'schedule.skip_date_added',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'workspace', id: workspaceId },
        newValue: input,
        requestId: actor.requestId,
      });
    });
  }

  async removeSkipDate(workspaceId: string, date: string, actor: Actor): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const removed = await tx
        .delete(workspaceSkipDates)
        .where(eq(workspaceSkipDates.skipDate, date))
        .returning({ date: workspaceSkipDates.skipDate });
      if (removed.length === 0) throw notFound('Date not found');
      await this.audit.record(tx, {
        action: 'schedule.skip_date_removed',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'workspace', id: workspaceId },
        oldValue: { date },
        requestId: actor.requestId,
      });
    });
  }

  /**
   * Deletes generated sessions that haven't started. Sessions with attendance are kept (they're
   * cancelled instead), so no record is ever lost (REQ-ATT-002).
   */
  private async removeFutureSessions(tx: DbTx, where: ReturnType<typeof and>): Promise<void> {
    const now = this.clock.now();
    const doomed = await tx
      .select({ id: classSessions.id })
      .from(classSessions)
      .where(and(where, gte(classSessions.startsAt, now)));
    if (doomed.length === 0) return;
    const ids = doomed.map((d) => d.id);
    const withRecords = await this.sessionsWithAttendance(tx, ids);
    const removable = ids.filter((id) => !withRecords.has(id));
    if (removable.length > 0) {
      await tx.delete(classSessions).where(inArray(classSessions.id, removable));
    }
    if (withRecords.size > 0) {
      await tx
        .update(classSessions)
        .set({ cancelledAt: now, cancelReason: 'schedule changed' })
        .where(
          and(
            inArray(classSessions.id, [...withRecords]),
            sql`${classSessions.cancelledAt} is null`,
          ),
        );
    }
  }

  private async sessionsWithAttendance(tx: DbTx, ids: string[]): Promise<Set<string>> {
    const rows = await tx
      .selectDistinct({ sessionId: attendanceRecords.sessionId })
      .from(attendanceRecords)
      .where(inArray(attendanceRecords.sessionId, ids));
    return new Set(rows.map((r) => r.sessionId));
  }

  private async overlaps(tx: DbTx, newSessions: ReturnType<typeof sql>): Promise<OverlapWarning[]> {
    const result = await tx.execute<{ class_name: string; starts_at: string | Date }>(sql`
      select distinct ca.name as class_name, a.starts_at
        from class_sessions a
        join classes ca on ca.id = a.class_id
        join class_sessions b on a.starts_at < b.ends_at and b.starts_at < a.ends_at and a.id <> b.id
        join classes cb on cb.id = b.class_id
       where ${newSessions}
         and ca.responsible_membership_id = cb.responsible_membership_id
         and a.cancelled_at is null and b.cancelled_at is null
       order by a.starts_at
       limit 10`);
    return result.rows.map((r) => ({ className: r.class_name, startsAt: new Date(r.starts_at) }));
  }

  private async sessionsWhere(
    tx: DbTx,
    where: ReturnType<typeof and>,
    limit: number,
  ): Promise<SessionView[]> {
    const rows = await tx
      .select({
        id: classSessions.id,
        classId: classSessions.classId,
        className: classes.name,
        seriesId: classSessions.seriesId,
        localDate: classSessions.localDate,
        startsAt: classSessions.startsAt,
        endsAt: classSessions.endsAt,
        cancelledAt: classSessions.cancelledAt,
        cancelReason: classSessions.cancelReason,
      })
      .from(classSessions)
      .innerJoin(classes, eq(classes.id, classSessions.classId))
      .where(where)
      .orderBy(asc(classSessions.startsAt))
      .limit(limit);
    return rows.map(({ cancelledAt, ...row }) => ({ ...row, cancelled: cancelledAt !== null }));
  }

  private async visibleClass(tx: DbTx, ctx: WorkspaceContext, classId: string): Promise<void> {
    const [row] = await tx
      .select({ id: classes.id })
      .from(classes)
      .where(and(eq(classes.id, classId), classScope(ctx)));
    if (!row) throw notFound('Class not found');
  }

  /** The class must be visible and covered by `schedule.manage`. */
  private async managedClass(tx: DbTx, ctx: WorkspaceContext, classId: string): Promise<void> {
    if (!ctx.permissions.coversClass('schedule.manage', classId)) throw notFound('Class not found');
    await this.visibleClass(tx, ctx, classId);
  }
}
