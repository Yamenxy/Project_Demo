import { describe, expect, it } from 'vitest';
import { acceptsAnswers, attemptDeadline, countedScore, isCorrect, shuffled } from './exam-rules';

const at = (iso: string) => new Date(iso);

describe('exam deadline (REQ-EXAM-002)', () => {
  it('is start plus the time limit when that ends before the window', () => {
    const deadline = attemptDeadline({
      startedAt: at('2026-10-01T10:00:00Z'),
      timeLimitMinutes: 30,
      closesAt: at('2026-10-01T12:00:00Z'),
      extraMinutes: 0,
    });
    expect(deadline.toISOString()).toBe('2026-10-01T10:30:00.000Z');
  });

  it('a late start is cut at the window end', () => {
    const deadline = attemptDeadline({
      startedAt: at('2026-10-01T11:50:00Z'),
      timeLimitMinutes: 30,
      closesAt: at('2026-10-01T12:00:00Z'),
      extraMinutes: 0,
    });
    expect(deadline.toISOString()).toBe('2026-10-01T12:00:00.000Z');
  });

  it('an accommodation extends the time, even past the window end', () => {
    const early = attemptDeadline({
      startedAt: at('2026-10-01T10:00:00Z'),
      timeLimitMinutes: 30,
      closesAt: at('2026-10-01T12:00:00Z'),
      extraMinutes: 15,
    });
    expect(early.toISOString()).toBe('2026-10-01T10:45:00.000Z');
    const late = attemptDeadline({
      startedAt: at('2026-10-01T11:50:00Z'),
      timeLimitMinutes: 30,
      closesAt: at('2026-10-01T12:00:00Z'),
      extraMinutes: 15,
    });
    expect(late.toISOString()).toBe('2026-10-01T12:15:00.000Z');
  });

  it('accepts answers up to 60 seconds after the deadline, and not at 61', () => {
    const deadline = at('2026-10-01T10:30:00Z');
    expect(acceptsAnswers(deadline, at('2026-10-01T10:31:00Z'))).toBe(true);
    expect(acceptsAnswers(deadline, at('2026-10-01T10:31:01Z'))).toBe(false);
  });
});

describe('grading and counted score (REQ-EXAM-001, REQ-QBANK-003)', () => {
  it('grades each kind', () => {
    expect(isCorrect('mcq', { correct: 'a1' }, { choiceId: 'a1' })).toBe(true);
    expect(isCorrect('mcq', { correct: 'a1' }, { choiceId: 'b2' })).toBe(false);
    expect(isCorrect('true_false', { value: false }, { value: false })).toBe(true);
    expect(
      isCorrect('short', { accepted: ['القاهرة'], arabicVariants: true }, { text: 'القاهره' }),
    ).toBe(true);
    expect(
      isCorrect('short', { accepted: ['القاهرة'], arabicVariants: false }, { text: 'القاهره' }),
    ).toBe(false);
    expect(isCorrect('mcq', { correct: 'a1' }, { text: 'a1' })).toBe(false);
  });

  it('counts the highest or the latest submitted attempt', () => {
    const attempts = [
      { number: 1, scoreCenti: 800, submitted: true },
      { number: 2, scoreCenti: 600, submitted: true },
      { number: 3, scoreCenti: null, submitted: false },
    ];
    expect(countedScore(attempts, 'highest')).toBe(800);
    expect(countedScore(attempts, 'latest')).toBe(600);
    expect(countedScore([], 'highest')).toBeNull();
  });

  it('shuffles without losing items', () => {
    let seed = 1;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const result = shuffled([1, 2, 3, 4, 5], random);
    expect([...result].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
