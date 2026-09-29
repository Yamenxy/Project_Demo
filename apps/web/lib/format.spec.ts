import { describe, expect, it } from 'vitest';
import { formatMoney, formatNumber, numberLocale, parseMoney } from './format';

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

describe('money (integer piastres)', () => {
  it('formats piastres as pounds', () => {
    expect(formatMoney(30000, 'en')).toContain('300');
    expect(formatMoney(12550, 'en')).toContain('125.50');
  });

  it('parses typed pounds, including Arabic-Indic digits and the Arabic decimal mark', () => {
    expect(parseMoney('150')).toBe(15000);
    expect(parseMoney('150.5')).toBe(15050);
    expect(parseMoney('١٥٠٫٧٥')).toBe(15075);
    expect(parseMoney('1.234')).toBeNull();
    expect(parseMoney('abc')).toBeNull();
    expect(parseMoney('')).toBeNull();
  });
});
