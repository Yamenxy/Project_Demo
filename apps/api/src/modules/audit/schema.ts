import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Mirrors drizzle/0001_audit_log.sql (partitioned, append-only). */
export const auditLog = pgTable('audit_log', {
  id: uuid('id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  workspaceId: uuid('workspace_id'),
  actorType: text('actor_type', {
    enum: ['user', 'platform_owner', 'support', 'system'],
  }).notNull(),
  actorUserId: uuid('actor_user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  oldValue: jsonb('old_value'),
  newValue: jsonb('new_value'),
  reason: text('reason'),
  requestId: text('request_id'),
  personalContext: jsonb('personal_context'),
});
