import { describe, expect, it } from 'vitest';
import { consentState, isLimited, isMinor } from './consent';

const at = (iso: string) => new Date(iso);

describe('guardian consent rules (REQ-PRIV-001)', () => {
  it('counts 18 years by calendar date', () => {
    expect(isMinor('2008-09-29', at('2026-09-28T23:59:59Z'))).toBe(true);
    expect(isMinor('2008-09-29', at('2026-09-29T00:00:00Z'))).toBe(false);
    // Born on 29 February: an adult from 1 March in non-leap years.
    expect(isMinor('2008-02-29', at('2026-02-28T12:00:00Z'))).toBe(true);
    expect(isMinor('2008-02-29', at('2026-03-01T00:00:00Z'))).toBe(false);
  });

  it('limits minors and unknown ages for 14 days, then marks them overdue', () => {
    const createdAt = at('2026-09-01T10:00:00Z');
    const minor = { dateOfBirth: '2012-05-01', createdAt, consentAt: null };
    expect(consentState(minor, at('2026-09-15T09:59:59Z'))).toBe('needed');
    expect(consentState(minor, at('2026-09-15T10:00:00Z'))).toBe('overdue');
    expect(consentState({ ...minor, dateOfBirth: null }, at('2026-09-02T00:00:00Z'))).toBe(
      'needed',
    );
    expect(isLimited('needed')).toBe(true);
    expect(isLimited('overdue')).toBe(true);
  });

  it('needs nothing for adults, and consent ends the limit', () => {
    const createdAt = at('2026-01-01T00:00:00Z');
    expect(
      consentState({ dateOfBirth: '2000-01-01', createdAt, consentAt: null }, at('2026-09-01Z')),
    ).toBe('not_required');
    const granted = consentState(
      { dateOfBirth: '2012-01-01', createdAt, consentAt: at('2026-08-01T00:00:00Z') },
      at('2026-09-01T00:00:00Z'),
    );
    expect(granted).toBe('granted');
    expect(isLimited(granted)).toBe(false);
  });
});
