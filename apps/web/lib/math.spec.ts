import { describe, expect, it } from 'vitest';
import { splitMath } from './math';

describe('maths in text (REQ-QBANK-001)', () => {
  it('splits $…$ from Arabic text and keeps escaped dollars', () => {
    expect(splitMath('إذا كانت $F = ma$ فإن')).toEqual([
      { math: false, value: 'إذا كانت ' },
      { math: true, value: 'F = ma' },
      { math: false, value: ' فإن' },
    ]);
    expect(splitMath('السعر \\$5')).toEqual([{ math: false, value: 'السعر $5' }]);
    expect(splitMath('بدون رياضيات')).toEqual([{ math: false, value: 'بدون رياضيات' }]);
  });
});
