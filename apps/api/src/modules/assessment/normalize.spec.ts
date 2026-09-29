import { describe, expect, it } from 'vitest';
import { matchesShortAnswer, normalizeAnswer } from './normalize';

describe('short-answer matching (REQ-QBANK-003)', () => {
  it('normalises digits, whitespace and case', () => {
    expect(normalizeAnswer('  ٣٫٥   Kg ', { arabicVariants: false })).toBe('3٫5 kg');
    expect(matchesShortAnswer(' 9.8 ', ['9.8'], { arabicVariants: false })).toBe(true);
    expect(matchesShortAnswer('٩٫٨', ['9٫8'], { arabicVariants: false })).toBe(true);
    expect(matchesShortAnswer('NEWTON', ['newton'], { arabicVariants: false })).toBe(true);
    expect(matchesShortAnswer('   ', ['x'], { arabicVariants: false })).toBe(false);
  });

  it('treats Arabic letter variants as equal only when enabled', () => {
    const accepted = ['القاهرة'];
    expect(matchesShortAnswer('القاهره', accepted, { arabicVariants: false })).toBe(false);
    expect(matchesShortAnswer('القاهره', accepted, { arabicVariants: true })).toBe(true);
    expect(matchesShortAnswer('إسكندرية', ['اسكندريه'], { arabicVariants: true })).toBe(true);
    expect(matchesShortAnswer('مُسْتَشْفَى', ['مستشفي'], { arabicVariants: true })).toBe(true);
    expect(matchesShortAnswer('قـــاهرة', ['قاهرة'], { arabicVariants: false })).toBe(true);
  });
});
