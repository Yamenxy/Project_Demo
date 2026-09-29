import { setRequestLocale } from 'next-intl/server';
import { Suspense, use } from 'react';
import { AcceptInvitation } from '../../../../components/workspace/accept-invitation';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return (
    <Suspense>
      <AcceptInvitation />
    </Suspense>
  );
}
