import { describe, expect, it } from 'vitest';
import { formatNumber, numberLocale } from './format';

describe('number formatting', () => {
  it('uses Western digits by default, even in Arabic', () => {
    expect(formatNumber(1250, 'ar')).toBe('1,250');
    expect(numberLocale('ar')).toBe('ar-EG-u-nu-latn');
  });

  it('uses Arabic-Indic digits when the user prefers them', () => {
    expect(formatNumber(1250, 'ar', 'arabic')).toBe('١٬٢٥٠');
  });

  it('formats money in EGP', () => {
    expect(formatNumber(150, 'en', 'western', { style: 'currency', currency: 'EGP' })).toContain(
      '150',
    );
  });
});
