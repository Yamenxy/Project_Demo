import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export type QuestionKind = 'mcq' | 'true_false' | 'short';
export interface Choice {
  id: string;
  text: string;
}
export type Answer =
  { correct: string } | { value: boolean } | { accepted: string[]; arabicVariants: boolean };

/** Mirrors drizzle/0028_questions.sql. */
export const questions = pgTable('questions', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  courseId: uuid('course_id').notNull(),
  currentVersion: integer('current_version').notNull(),
  archivedAt: tstz('archived_at'),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

/** Immutable: the runtime role has no UPDATE or DELETE. */
export const questionVersions = pgTable('question_versions', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  questionId: uuid('question_id').notNull(),
  version: integer('version').notNull(),
  kind: text('kind', { enum: ['mcq', 'true_false', 'short'] }).notNull(),
  body: text('body').notNull(),
  choices: jsonb('choices').$type<Choice[]>().notNull().default([]),
  answer: jsonb('answer').$type<Answer>().notNull(),
  feedback: text('feedback'),
  pointsCenti: integer('points_centi').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: tstz('created_at').notNull(),
});
