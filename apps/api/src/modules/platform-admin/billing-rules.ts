/**
 * Subscription rules for Flow A (REQ-SUB-001, D12a), as pure functions so they're easy to test.
 */
export const TRIAL_DAYS = 14;
const DAY = 24 * 3600 * 1000;

export type SubscriptionStatus = 'trial' | 'active' | 'grace' | 'lapsed';

export function subscriptionStatus(
  periodEndsAt: Date,
  graceDays: number,
  hasPayments: boolean,
  now: Date,
): SubscriptionStatus {
  if (now.getTime() <= periodEndsAt.getTime()) return hasPayments ? 'active' : 'trial';
  if (now.getTime() <= periodEndsAt.getTime() + graceDays * DAY) return 'grace';
  return 'lapsed';
}

/** Adds calendar months in UTC, clamping to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/**
 * A payment extends from the later of the current end and now, so paying early never loses
 * days and paying late doesn't back-date the period.
 */
export function extendPeriod(periodEndsAt: Date, months: number, now: Date): Date {
  const from = periodEndsAt.getTime() > now.getTime() ? periodEndsAt : now;
  return addMonths(from, months);
}

export type ReminderKind = 'before_end' | 'on_end' | 'after_end';

/** Which reminder is due now, if any (review §3.18: 3 days before, on the day, 3 days after). */
export function dueReminder(periodEndsAt: Date, now: Date): ReminderKind | null {
  const diff = now.getTime() - periodEndsAt.getTime();
  if (diff >= 3 * DAY) return 'after_end';
  if (diff >= 0) return 'on_end';
  if (diff >= -3 * DAY) return 'before_end';
  return null;
}
