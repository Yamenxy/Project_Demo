import { setRequestLocale } from 'next-intl/server';
import { use, type ReactNode } from 'react';
import { WorkspaceShell } from '../../../../components/workspace/workspace-shell';

export default function Layout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string; workspaceId: string }>;
}) {
  const { locale, workspaceId } = use(params);
  setRequestLocale(locale);
  return <WorkspaceShell workspaceId={workspaceId}>{children}</WorkspaceShell>;
}
