import { date, integer, pgTable, smallint, text, time, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors drizzle/0017_schedules.sql. */
export const classSeries = pgTable('class_series', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  classId: uuid('class_id').notNull(),
  weekday: smallint('weekday').notNull(),
  startTime: time('start_time').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  timeZone: text('time_zone').notNull().default('Africa/Cairo'),
  startsOn: date('starts_on').notNull(),
  endsOn: date('ends_on'),
  createdAt: tstz('created_at').notNull(),
});

export const workspaceSkipDates = pgTable('workspace_skip_dates', {
  workspaceId: uuid('workspace_id').notNull(),
  skipDate: date('skip_date').notNull(),
  reason: text('reason'),
  createdAt: tstz('created_at').notNull(),
});

export const classSessions = pgTable('class_sessions', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  classId: uuid('class_id').notNull(),
  seriesId: uuid('series_id'),
  localDate: date('local_date').notNull(),
  startsAt: tstz('starts_at').notNull(),
  endsAt: tstz('ends_at').notNull(),
  cancelledAt: tstz('cancelled_at'),
  cancelReason: text('cancel_reason'),
  createdAt: tstz('created_at').notNull(),
});

/** Mirrors drizzle/0018_attendance.sql. */
export const attendanceRecords = pgTable('attendance_records', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  status: text('status', { enum: ['present', 'late', 'absent', 'excused'] }).notNull(),
  method: text('method', { enum: ['manual', 'qr'] }).notNull(),
  takenAt: tstz('taken_at').notNull(),
  recordedBy: uuid('recorded_by').notNull(),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});
