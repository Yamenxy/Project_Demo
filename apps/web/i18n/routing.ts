import { defineRouting } from 'next-intl/routing';

/** Arabic first (right-to-left), English second (D32, REQ-I18N-001). */
export const routing = defineRouting({
  locales: ['ar', 'en'],
  defaultLocale: 'ar',
  localePrefix: 'always',
  // Arabic unless the user switches: many phones here are set to English (D32).
  localeDetection: false,
});

export type Locale = (typeof routing.locales)[number];

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}
