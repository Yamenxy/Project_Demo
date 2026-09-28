import type { Locale } from '../i18n/routing';

export type DigitStyle = 'western' | 'arabic';

/**
 * Western digits by default in both languages, with Arabic-Indic digits as a user preference
 * (REQ-I18N-001).
 */
export function numberLocale(locale: Locale, digits: DigitStyle = 'western'): string {
  const base = locale === 'ar' ? 'ar-EG' : 'en-EG';
  return `${base}-u-nu-${digits === 'western' ? 'latn' : 'arab'}`;
}

export function formatNumber(
  value: number,
  locale: Locale,
  digits: DigitStyle = 'western',
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(numberLocale(locale, digits), options).format(value);
}
