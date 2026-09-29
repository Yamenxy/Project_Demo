import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors drizzle/0025_files.sql. */
export const files = pgTable('files', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  ownerType: text('owner_type', { enum: ['lesson', 'payment_request'] }).notNull(),
  ownerId: uuid('owner_id').notNull(),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  status: text('status', { enum: ['quarantine', 'available', 'rejected'] }).notNull(),
  rejectReason: text('reject_reason'),
  uploadedBy: uuid('uploaded_by').notNull(),
  deletedAt: tstz('deleted_at'),
  createdAt: tstz('created_at').notNull(),
});
