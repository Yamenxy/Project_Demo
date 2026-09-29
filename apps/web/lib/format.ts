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

/** Formats integer piastres as money (architecture §6). */
export function formatMoney(
  piastres: number,
  locale: Locale,
  currency = 'EGP',
  digits: DigitStyle = 'western',
): string {
  return formatNumber(piastres / 100, locale, digits, {
    style: 'currency',
    currency,
    minimumFractionDigits: piastres % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Reads an amount typed in pounds ("150", "150.5", "١٥٠٫٥") as integer piastres, or null when it
 * isn't a valid amount with at most two decimals.
 */
export function parseMoney(typed: string): number | null {
  const western = typed
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[٫,]/g, '.');
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(western)) return null;
  const [whole = '0', fraction = ''] = western.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}
