import { setRequestLocale } from 'next-intl/server';
import { use } from 'react';
import { WorkspaceDetail } from '../../../../components/platform/workspace-detail';

export default function Page({
  params,
}: {
  params: Promise<{ locale: string; workspaceId: string }>;
}) {
  const { locale, workspaceId } = use(params);
  setRequestLocale(locale);
  return <WorkspaceDetail workspaceId={workspaceId} />;
}
