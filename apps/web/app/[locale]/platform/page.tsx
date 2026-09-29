import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { PlatformConsole } from '../../../components/platform/platform-console';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <PlatformConsole />;
}
