import { describe, expect, it } from 'vitest';
import { addMonths, dueReminder, extendPeriod, subscriptionStatus } from './billing-rules';

const at = (iso: string) => new Date(iso);

describe('subscriptionStatus', () => {
  const end = at('2026-10-31T00:00:00Z');
  it.each([
    ['2026-10-30T00:00:00Z', false, 'trial'],
    ['2026-10-30T00:00:00Z', true, 'active'],
    ['2026-11-03T00:00:00Z', true, 'grace'],
    ['2026-11-07T00:00:00Z', true, 'grace'],
    ['2026-11-08T00:00:01Z', true, 'lapsed'],
  ])('at %s (paid=%s) → %s', (now, paid, status) => {
    expect(subscriptionStatus(end, 7, paid, at(now))).toBe(status);
  });
});

describe('addMonths', () => {
  it('clamps to the end of shorter months', () => {
    expect(addMonths(at('2026-01-31T10:00:00Z'), 1).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(at('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonths(at('2026-11-15T00:00:00Z'), 3).toISOString()).toBe('2027-02-15T00:00:00.000Z');
  });
});

describe('extendPeriod', () => {
  const now = at('2026-10-10T00:00:00Z');
  it('extends from the current end when paying early', () => {
    expect(extendPeriod(at('2026-10-20T00:00:00Z'), 1, now).toISOString()).toBe(
      '2026-11-20T00:00:00.000Z',
    );
  });
  it('extends from now when paying late', () => {
    expect(extendPeriod(at('2026-09-01T00:00:00Z'), 1, now).toISOString()).toBe(
      '2026-11-10T00:00:00.000Z',
    );
  });
});

describe('dueReminder', () => {
  const end = at('2026-10-31T00:00:00Z');
  it.each([
    ['2026-10-27T00:00:00Z', null],
    ['2026-10-28T00:00:00Z', 'before_end'],
    ['2026-10-31T00:00:00Z', 'on_end'],
    ['2026-11-02T00:00:00Z', 'on_end'],
    ['2026-11-03T00:00:00Z', 'after_end'],
  ])('at %s → %s', (now, kind) => {
    expect(dueReminder(end, at(now))).toBe(kind);
  });
});
