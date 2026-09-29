import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { ConsentView } from '../../../components/auth/consent-view';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <ConsentView />;
}
