/**
 * Guardian consent rules (REQ-PRIV-001, OQ-09). Pure functions, shared by the consent service and
 * the per-request access check.
 */

/** The consent text shown to guardians. Bump when the text changes; records keep the version. */
export const CONSENT_VERSION = '2026-09';

/** How long an account can stay limited without consent. */
export const CONSENT_GRACE_DAYS = 14;

/**
 * - `not_required`: 18 or older.
 * - `granted`: a guardian consented.
 * - `needed`: under 18 or date of birth unknown, still inside the grace period (limited account).
 * - `overdue`: the grace period is over; workspace access as a student stops until consent.
 */
export type ConsentState = 'not_required' | 'granted' | 'needed' | 'overdue';

export interface ConsentFacts {
  /** ISO date (YYYY-MM-DD) or null when the user hasn't given it. */
  dateOfBirth: string | null;
  createdAt: Date;
  consentAt: Date | null;
}

/** Whether someone born on `dateOfBirth` is under 18 on `now` (by calendar date, UTC). */
export function isMinor(dateOfBirth: string, now: Date): boolean {
  const [year, month, day] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const eighteenth = Date.UTC(year + 18, month - 1, day);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return today < eighteenth;
}

export function consentDueAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + CONSENT_GRACE_DAYS * 24 * 3600 * 1000);
}

export function consentState(facts: ConsentFacts, now: Date): ConsentState {
  if (facts.dateOfBirth && !isMinor(facts.dateOfBirth, now)) return 'not_required';
  if (facts.consentAt) return 'granted';
  return now < consentDueAt(facts.createdAt) ? 'needed' : 'overdue';
}

/** Limited accounts can't upload files (REQ-PRIV-001); checked by the files module. */
export function isLimited(state: ConsentState): boolean {
  return state === 'needed' || state === 'overdue';
}
