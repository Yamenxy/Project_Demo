import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors drizzle/0010_notifications.sql (partitioned by month). */
export const pushSubscriptions = pgTable('push_subscriptions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
});

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
