import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors drizzle/0015_classes.sql. */
export const classes = pgTable('classes', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  responsibleMembershipId: uuid('responsible_membership_id').notNull(),
  archivedAt: tstz('archived_at'),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
  version: integer('version').notNull().default(1),
});

export const classEnrollments = pgTable('class_enrollments', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  classId: uuid('class_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  enrolledAt: tstz('enrolled_at').notNull(),
  enrolledBy: uuid('enrolled_by').notNull(),
  endedAt: tstz('ended_at'),
  endReason: text('end_reason', { enum: ['removed', 'transferred'] }),
  endedBy: uuid('ended_by'),
});
