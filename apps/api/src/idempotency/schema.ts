import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors drizzle/0009_idempotency.sql. */
export const idempotencyKeys = pgTable('idempotency_keys', {
  keyHash: text('key_hash').primaryKey(),
  userId: uuid('user_id').notNull(),
  requestHash: text('request_hash').notNull(),
  status: text('status', { enum: ['in_progress', 'completed'] }).notNull(),
  responseStatus: integer('response_status'),
  responseBody: jsonb('response_body'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
