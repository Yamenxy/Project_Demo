import { bigint, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
