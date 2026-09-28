import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { TwoFactorForm } from '../../../components/auth/forms';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <TwoFactorForm />;
}
