import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { AccountView } from '../../../components/auth/account-view';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <AccountView />;
}
