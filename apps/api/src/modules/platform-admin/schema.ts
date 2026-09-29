import { date, integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const PLANS = ['starter', 'growth', 'pro'] as const;
export type Plan = (typeof PLANS)[number];

export const PAYMENT_METHODS = ['cash', 'instapay', 'wallet', 'bank_transfer', 'fawry'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** Mirrors drizzle/0011_subscriptions.sql. */
export const subscriptions = pgTable('subscriptions', {
  workspaceId: uuid('workspace_id').primaryKey(),
  plan: text('plan', { enum: PLANS }).notNull(),
  periodEndsAt: tstz('period_ends_at').notNull(),
  graceDays: integer('grace_days').notNull(),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

export const platformPayments = pgTable('platform_payments', {
  id: uuid('id').primaryKey(),
  workspaceId: uuid('workspace_id').notNull(),
  amountPiastres: integer('amount_piastres').notNull(),
  currency: text('currency').notNull(),
  method: text('method', { enum: PAYMENT_METHODS }).notNull(),
  reference: text('reference'),
  paidOn: date('paid_on').notNull(),
  months: integer('months').notNull(),
  notes: text('notes'),
  recordedBy: uuid('recorded_by').notNull(),
  createdAt: tstz('created_at').notNull(),
});

export const subscriptionReminders = pgTable(
  'subscription_reminders',
  {
    workspaceId: uuid('workspace_id').notNull(),
    periodEndsAt: tstz('period_ends_at').notNull(),
    kind: text('kind', { enum: ['before_end', 'on_end', 'after_end'] }).notNull(),
    sentAt: tstz('sent_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.periodEndsAt, t.kind] })],
);
