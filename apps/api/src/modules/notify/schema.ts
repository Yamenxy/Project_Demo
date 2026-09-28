import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors drizzle/0010_notifications.sql (partitioned by month). */
export const notifications = pgTable('notifications', {
  id: uuid('id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  recipientUserId: uuid('recipient_user_id').notNull(),
  workspaceId: uuid('workspace_id'),
  type: text('type').notNull(),
  params: jsonb('params').$type<Record<string, string | number | boolean>>().notNull(),
  link: text('link'),
  readAt: timestamp('read_at', { withTimezone: true }),
});
