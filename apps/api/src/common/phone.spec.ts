import { describe, expect, it } from 'vitest';
import { normalizePhone, toWesternDigits } from './phone';

describe('normalizePhone', () => {
  it.each([
    ['01012345678', '+201012345678'],
    ['0 101 234 5678', '+201012345678'],
    ['010-1234-5678', '+201012345678'],
    ['(010) 12345678', '+201012345678'],
    ['1012345678', '+201012345678'], // Excel dropped the leading zero
    ['+201112345678', '+201112345678'],
    ['00201212345678', '+201212345678'],
    ['201512345678', '+201512345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '+201012345678'], // Arabic-Indic digits
    ['۰۱۰۱۲۳۴۵۶۷۸', '+201012345678'], // Persian digits
    ['‎+20 10 1234 5678', '+201012345678'], // left-to-right mark from copy and paste
    ['+971501234567', '+971501234567'], // student abroad
    ['00966512345678', '+966512345678'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    '',
    '0101234567', // too short
    '010123456789', // too long
    '01312345678', // 013 is not an Egyptian mobile prefix
    '0223456789', // Cairo landline
    '+2001012345678', // malformed +20
    '+20223456789', // +20 but not a mobile
    'abc',
    '+',
    '12345', // too short even internationally, and no prefix
  ])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe('toWesternDigits', () => {
  it('converts Arabic-Indic and Persian digits and leaves other text', () => {
    expect(toWesternDigits('٥ و ۷ = 12')).toBe('5 و 7 = 12');
  });
});
