import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors drizzle/0027_grading.sql. Scores are integer hundredths of a point. */
export const gradeItems = pgTable('grade_items', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  classId: uuid('class_id').notNull(),
  title: text('title').notNull(),
  maxScoreCenti: integer('max_score_centi').notNull(),
  kind: text('kind', { enum: ['paper', 'exam', 'homework'] }).notNull(),
  sourceId: uuid('source_id'),
  releasedAt: tstz('released_at'),
  archivedAt: tstz('archived_at'),
  createdBy: uuid('created_by').notNull(),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

export const gradeEntries = pgTable('grade_entries', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  itemId: uuid('item_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  scoreCenti: integer('score_centi'),
  updatedBy: uuid('updated_by').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

/** Append-only. */
export const gradeChanges = pgTable('grade_changes', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  entryId: uuid('entry_id').notNull(),
  oldScoreCenti: integer('old_score_centi'),
  newScoreCenti: integer('new_score_centi'),
  changedBy: uuid('changed_by').notNull(),
  reason: text('reason'),
  changedAt: tstz('changed_at').notNull(),
});
