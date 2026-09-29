import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { NotificationsView } from '../../../components/notify/notifications-view';

export default function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  setRequestLocale(locale);
  return <NotificationsView />;
}
