import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const announcements = pgTable('announcements', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  classId: uuid('class_id'),
  title: text('title').notNull(),
  body: text('body').notNull(),
  authorUserId: uuid('author_user_id').notNull(),
  createdAt: tstz('created_at').notNull(),
  recipients: integer('recipients').notNull(),
  fanoutCursor: uuid('fanout_cursor'),
  fanoutDoneAt: tstz('fanout_done_at'),
});
