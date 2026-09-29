import { bigint, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors drizzle/0019_price_list.sql. */
export const priceItems = pgTable('price_items', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  amountPiastres: bigint('amount_piastres', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('EGP'),
  description: text('description'),
  archivedAt: tstz('archived_at'),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

/** Mirrors drizzle/0020_payment_ledger.sql. */
export const receiptCounters = pgTable('receipt_counters', {
  workspaceId: uuid('workspace_id').primaryKey(),
  lastNumber: integer('last_number').notNull(),
});

/** Append-only (REQ-PAY-007): the runtime role has no UPDATE or DELETE. */
export const paymentEntries = pgTable('payment_entries', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  membershipId: uuid('membership_id').notNull(),
  kind: text('kind', { enum: ['payment', 'reversal'] }).notNull(),
  amountPiastres: bigint('amount_piastres', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('EGP'),
  method: text('method', { enum: ['cash', 'transfer', 'wallet', 'other'] }).notNull(),
  collectedBy: uuid('collected_by'),
  priceItemId: uuid('price_item_id'),
  itemName: text('item_name'),
  itemPricePiastres: bigint('item_price_piastres', { mode: 'number' }),
  note: text('note'),
  reversesId: uuid('reverses_id'),
  requestId: uuid('request_id'),
  receiptNumber: integer('receipt_number').notNull(),
  recordedBy: uuid('recorded_by').notNull(),
  recordedAt: tstz('recorded_at').notNull(),
});

/** Mirrors drizzle/0021_payment_requests.sql. */
export const paymentRequests = pgTable('payment_requests', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  membershipId: uuid('membership_id').notNull(),
  submittedBy: uuid('submitted_by').notNull(),
  amountPiastres: bigint('amount_piastres', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('EGP'),
  method: text('method', { enum: ['transfer', 'wallet', 'other'] }).notNull(),
  reference: text('reference').notNull(),
  note: text('note'),
  status: text('status', { enum: ['pending', 'approved', 'rejected', 'cancelled'] }).notNull(),
  resubmitsId: uuid('resubmits_id'),
  decidedBy: uuid('decided_by'),
  decidedAt: tstz('decided_at'),
  rejectReason: text('reject_reason'),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

/** Mirrors drizzle/0022_cash_handovers.sql. */
export const cashHandovers = pgTable('cash_handovers', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  handedBy: uuid('handed_by').notNull(),
  amountPiastres: bigint('amount_piastres', { mode: 'number' }).notNull(),
  currency: text('currency').notNull().default('EGP'),
  note: text('note'),
  status: text('status', { enum: ['pending', 'confirmed', 'rejected'] }).notNull(),
  decidedBy: uuid('decided_by'),
  decidedAt: tstz('decided_at'),
  createdAt: tstz('created_at').notNull(),
});
