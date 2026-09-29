import { Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { TenantDb, type DbTx } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { memberships, type WorkspaceContext } from '../tenancy';
import type { Actor } from './classes.service';
import { classScope } from './classes.service';
import { attendanceRecords, classSessions } from './schedule-schema';
import { classEnrollments, classes } from './schema';

/** Records can be changed freely until 48 hours after the session ends (Appendix A.2). */
export const EDIT_WINDOW_MS = 48 * 3600 * 1000;

export type AttendanceStatus = 'present' | 'late' | 'absent' | 'excused';

export interface RosterStudent {
  membershipId: string;
  name: string;
  platformCode: string | null;
  paused: boolean;
  status: AttendanceStatus | null;
}

export interface Roster {
  session: {
    id: string;
    classId: string;
    className: string;
    startsAt: Date;
    endsAt: Date;
    cancelled: boolean;
    /** Past the 48-hour window: changes need `attendance.edit_late` and a reason. */
    locked: boolean;
  };
  students: RosterStudent[];
  /**
   * Other students of the workspace (names and codes only), so an offline scanner can tell a
   * student who isn't in this class (amber) from an unknown code (red) (REQ-ATT-001).
   */
  others: Omit<RosterStudent, 'status'>[];
}

export interface AttendanceInput {
  membershipId: string;
  status: AttendanceStatus;
  method: 'manual' | 'qr';
  takenAt?: Date;
}

export interface AttendanceSummaryRow {
  membershipId: string;
  name: string;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** Present or late, out of recorded sessions; cancelled sessions don't count (REQ-ATT-002). */
  rate: number | null;
}

const nameOf = sql<string>`coalesce(${users.nameAr}, ${memberships.provisionalName})`;

/** Attendance per session (REQ-ATT-001, REQ-ATT-002). */
@Injectable()
export class AttendanceService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async roster(ctx: WorkspaceContext, sessionId: string): Promise<Roster> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const session = await this.session(tx, ctx, sessionId);
      const students = await tx
        .select({
          membershipId: memberships.id,
          name: nameOf,
          platformCode: users.platformCode,
          pausedAt: memberships.pausedAt,
          status: attendanceRecords.status,
        })
        .from(classEnrollments)
        .innerJoin(memberships, eq(memberships.id, classEnrollments.membershipId))
        .leftJoin(users, eq(users.id, memberships.userId))
        .leftJoin(
          attendanceRecords,
          and(
            eq(attendanceRecords.membershipId, memberships.id),
            eq(attendanceRecords.sessionId, sessionId),
          ),
        )
        .where(and(eq(classEnrollments.classId, session.classId), isNull(classEnrollments.endedAt)))
        .orderBy(asc(nameOf));
      const enrolled = new Set(students.map((s) => s.membershipId));
      const everyone = await tx
        .select({
          membershipId: memberships.id,
          name: nameOf,
          platformCode: users.platformCode,
          pausedAt: memberships.pausedAt,
          status: attendanceRecords.status,
        })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .leftJoin(
          attendanceRecords,
          and(
            eq(attendanceRecords.membershipId, memberships.id),
            eq(attendanceRecords.sessionId, sessionId),
          ),
        )
        .where(
          and(
            eq(memberships.role, 'student'),
            inArray(memberships.status, ['active', 'suspended']),
          ),
        );
      // Students outside the class who were recorded anyway appear in the roster too.
      const recordedOthers = everyone.filter((s) => !enrolled.has(s.membershipId) && s.status);
      const toStudent = (s: (typeof students)[number]): RosterStudent => ({
        membershipId: s.membershipId,
        name: s.name,
        platformCode: s.platformCode,
        paused: s.pausedAt !== null,
        status: s.status,
      });
      return {
        session: {
          id: session.id,
          classId: session.classId,
          className: session.className,
          startsAt: session.startsAt,
          endsAt: session.endsAt,
          cancelled: session.cancelledAt !== null,
          locked: this.isLocked(session.endsAt),
        },
        students: [...students, ...recordedOthers].map(toStudent),
        others: everyone
          .filter((s) => !enrolled.has(s.membershipId))
          .map(({ status: _status, ...s }) => ({
            membershipId: s.membershipId,
            name: s.name,
            platformCode: s.platformCode,
            paused: s.pausedAt !== null,
          })),
      };
    });
  }

  /**
   * Saves attendance. Manual entries overwrite; scans only fill in a missing record, so a scan
   * uploaded twice, or from two devices, changes nothing (REQ-ATT-001).
   */
  async record(
    ctx: WorkspaceContext,
    sessionId: string,
    input: { records: AttendanceInput[]; reason?: string },
    actor: Actor,
  ): Promise<{ saved: number }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const session = await this.session(tx, ctx, sessionId);
      if (session.cancelledAt) throw new AppError(409, 'session_cancelled', 'Session cancelled');
      const late = this.isLocked(session.endsAt);
      if (late) {
        if (!ctx.permissions.coversClass('attendance.edit_late', session.classId)) {
          throw new AppError(403, 'attendance_locked', 'Older than 48 hours');
        }
        if (!input.reason || input.reason.trim().length < 3) {
          throw new AppError(400, 'reason_required', 'Give a reason for a late change');
        }
      }
      const ids = [...new Set(input.records.map((r) => r.membershipId))];
      const valid = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            inArray(memberships.id, ids),
            eq(memberships.role, 'student'),
            inArray(memberships.status, ['active', 'suspended']),
          ),
        );
      if (valid.length !== ids.length) throw notFound('Student not found');

      const before = new Map(
        (
          await tx
            .select({
              membershipId: attendanceRecords.membershipId,
              status: attendanceRecords.status,
            })
            .from(attendanceRecords)
            .where(eq(attendanceRecords.sessionId, sessionId))
            .for('update')
        ).map((r) => [r.membershipId, r.status]),
      );
      const now = this.clock.now();
      let saved = 0;
      for (const record of input.records) {
        const values = {
          workspaceId: ctx.workspaceId,
          id: this.ids.newId(),
          sessionId,
          membershipId: record.membershipId,
          status: record.status,
          method: record.method,
          takenAt: record.takenAt && record.takenAt < now ? record.takenAt : now,
          recordedBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        };
        const insert = tx.insert(attendanceRecords).values(values);
        const rows =
          record.method === 'qr'
            ? await insert.onConflictDoNothing().returning({ id: attendanceRecords.id })
            : await insert
                .onConflictDoUpdate({
                  target: [attendanceRecords.sessionId, attendanceRecords.membershipId],
                  set: {
                    status: record.status,
                    method: 'manual',
                    takenAt: values.takenAt,
                    recordedBy: actor.userId,
                    updatedAt: now,
                  },
                  setWhere: sql`${attendanceRecords.status} <> ${record.status}`,
                })
                .returning({ id: attendanceRecords.id });
        if (rows.length === 0) continue;
        saved++;
        if (late) {
          await this.audit.record(tx, {
            action: 'attendance.edited_late',
            workspaceId: ctx.workspaceId,
            actor: { type: 'user', userId: actor.userId },
            entity: { type: 'membership', id: record.membershipId },
            oldValue: { sessionId, status: before.get(record.membershipId) ?? null },
            newValue: { sessionId, status: record.status },
            reason: input.reason?.trim(),
            requestId: actor.requestId,
          });
        }
      }
      if (!late && saved > 0) {
        await this.audit.record(tx, {
          action: 'attendance.recorded',
          workspaceId: ctx.workspaceId,
          actor: { type: 'user', userId: actor.userId },
          entity: { type: 'session', id: sessionId },
          newValue: { saved },
          requestId: actor.requestId,
        });
      }
      return { saved };
    });
  }

  /** Per-student counts for a class; cancelled sessions are left out (REQ-ATT-002). */
  async classSummary(ctx: WorkspaceContext, classId: string): Promise<AttendanceSummaryRow[]> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      if (!ctx.permissions.coversClass('attendance.mark', classId))
        throw notFound('Class not found');
      const [visible] = await tx
        .select({ id: classes.id })
        .from(classes)
        .where(and(eq(classes.id, classId), classScope(ctx)));
      if (!visible) throw notFound('Class not found');
      const rows = await tx.execute<{
        membership_id: string;
        name: string;
        present: number;
        late: number;
        absent: number;
        excused: number;
      }>(sql`
        select m.id as membership_id, coalesce(u.name_ar, m.provisional_name) as name,
               count(*) filter (where a.status = 'present')::int as present,
               count(*) filter (where a.status = 'late')::int as late,
               count(*) filter (where a.status = 'absent')::int as absent,
               count(*) filter (where a.status = 'excused')::int as excused
          from class_enrollments e
          join memberships m on m.id = e.membership_id
          left join users u on u.id = m.user_id
          left join class_sessions s on s.class_id = e.class_id and s.cancelled_at is null
          left join attendance_records a on a.session_id = s.id and a.membership_id = m.id
         where e.class_id = ${classId} and e.ended_at is null
         group by m.id, u.name_ar, m.provisional_name
         order by 2`);
      return rows.rows.map((r) => ({
        membershipId: r.membership_id,
        name: r.name,
        present: r.present,
        late: r.late,
        absent: r.absent,
        excused: r.excused,
        rate: rate(r),
      }));
    });
  }

  /** A student's own attendance, across their classes. */
  async mine(ctx: WorkspaceContext): Promise<{
    records: {
      sessionId: string;
      className: string;
      startsAt: Date;
      status: AttendanceStatus;
      cancelled: boolean;
    }[];
    rate: number | null;
  }> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const rows = await tx
        .select({
          sessionId: classSessions.id,
          className: classes.name,
          startsAt: classSessions.startsAt,
          status: attendanceRecords.status,
          cancelledAt: classSessions.cancelledAt,
        })
        .from(attendanceRecords)
        .innerJoin(classSessions, eq(classSessions.id, attendanceRecords.sessionId))
        .innerJoin(classes, eq(classes.id, classSessions.classId))
        .where(eq(attendanceRecords.membershipId, ctx.membershipId))
        .orderBy(asc(classSessions.startsAt));
      const counted = rows.filter((r) => r.cancelledAt === null);
      const count = (status: AttendanceStatus) => counted.filter((r) => r.status === status).length;
      return {
        records: rows.map(({ cancelledAt, ...r }) => ({ ...r, cancelled: cancelledAt !== null })),
        rate: rate({
          present: count('present'),
          late: count('late'),
          absent: count('absent'),
          excused: count('excused'),
        }),
      };
    });
  }

  private isLocked(endsAt: Date): boolean {
    return this.clock.now().getTime() > endsAt.getTime() + EDIT_WINDOW_MS;
  }

  /** The session, if its class is visible and covered by `attendance.mark`; otherwise 404. */
  private async session(tx: DbTx, ctx: WorkspaceContext, sessionId: string) {
    const [session] = await tx
      .select({
        id: classSessions.id,
        classId: classSessions.classId,
        className: classes.name,
        startsAt: classSessions.startsAt,
        endsAt: classSessions.endsAt,
        cancelledAt: classSessions.cancelledAt,
      })
      .from(classSessions)
      .innerJoin(classes, eq(classes.id, classSessions.classId))
      .where(and(eq(classSessions.id, sessionId), classScope(ctx)));
    if (!session || !ctx.permissions.coversClass('attendance.mark', session.classId)) {
      throw notFound('Session not found');
    }
    return session;
  }
}

/** Present or late, out of all recorded (excused counts as recorded but not attended). */
function rate(r: {
  present: number;
  late: number;
  absent: number;
  excused: number;
}): number | null {
  const total = r.present + r.late + r.absent + r.excused;
  return total === 0 ? null : Math.round(((r.present + r.late) / total) * 100);
}
