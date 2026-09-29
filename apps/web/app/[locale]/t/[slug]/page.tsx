import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { TeacherPageView } from '../../../../components/public/teacher-page';

export default function Page({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = use(params);
  setRequestLocale(locale);
  return <TeacherPageView slug={slug} />;
}
