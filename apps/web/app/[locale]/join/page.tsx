import { setRequestLocale } from 'next-intl/server';
import { Suspense, use } from 'react';
import { JoinTeacher } from '../../../components/workspace/join-teacher';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return (
    <Suspense>
      <JoinTeacher />
    </Suspense>
  );
}
