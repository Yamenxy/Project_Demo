import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors drizzle/0023_content.sql. */
export const courses = pgTable('courses', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  title: text('title').notNull(),
  description: text('description'),
  deletedAt: tstz('deleted_at'),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

export const lessons = pgTable('lessons', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  courseId: uuid('course_id').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  position: integer('position').notNull(),
  publishedAt: tstz('published_at'),
  deletedAt: tstz('deleted_at'),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});
