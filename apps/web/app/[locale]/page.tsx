import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { Link } from '../../i18n/navigation';
import type { Locale } from '../../i18n/routing';

export default function HomePage({ params }: { params: Promise<{ locale: Locale }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations();
  const other: Locale = locale === 'ar' ? 'en' : 'ar';

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-4 py-10">
      <header className="flex items-center justify-between">
        <p className="text-lg font-semibold text-brand">{t('common.appName')}</p>
        <Link href="/" locale={other} className="text-sm text-muted underline">
          {t('common.switchLanguage')}
        </Link>
      </header>
      <h1 className="text-2xl font-semibold">{t('home.headline')}</h1>
      <div className="flex flex-col gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-brand px-4 py-3 text-center font-semibold text-brand-contrast"
        >
          {t('home.signIn')}
        </Link>
        <Link href="/register" className="rounded-lg border px-4 py-3 text-center">
          {t('home.register')}
        </Link>
      </div>
    </main>
  );
}
