import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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

/** Mirrors drizzle/0024_access.sql. */
export const accessGroups = pgTable('access_groups', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  archivedAt: tstz('archived_at'),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

export const accessGroupLessons = pgTable(
  'access_group_lessons',
  {
    workspaceId: uuid('workspace_id').notNull(),
    groupId: uuid('group_id').notNull(),
    lessonId: uuid('lesson_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.lessonId] })],
);

export const accessGroupMembers = pgTable(
  'access_group_members',
  {
    workspaceId: uuid('workspace_id').notNull(),
    groupId: uuid('group_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    addedBy: uuid('added_by').notNull(),
    addedAt: tstz('added_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.membershipId] })],
);

export const lessonRules = pgTable(
  'lesson_rules',
  {
    workspaceId: uuid('workspace_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    lessonId: uuid('lesson_id').notNull(),
    kind: text('kind', { enum: ['grant', 'block'] }).notNull(),
    setBy: uuid('set_by').notNull(),
    setAt: tstz('set_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.membershipId, t.lessonId] })],
);
