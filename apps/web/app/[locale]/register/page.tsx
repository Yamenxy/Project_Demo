import { setRequestLocale } from 'next-intl/server';
import { Suspense, use } from 'react';
import { RegisterForm } from '../../../components/auth/forms';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
