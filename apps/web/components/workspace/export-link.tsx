'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useWorkspace } from './workspace-shell';

/**
 * A CSV download (REQ-REPORT-001), shown to holders of `data.export`; the API checks the scope
 * and audits the export. `path` is under `/w/:id/exports/`, and the file follows the UI language.
 */
export function ExportLink({ path, label }: { path: string; label: string }) {
  const t = useTranslations('exports');
  const locale = useLocale();
  const { workspace, membership, permissions } = useWorkspace();
  if (membership.role !== 'owner' && !permissions.includes('data.export')) return null;
  const separator = path.includes('?') ? '&' : '?';
  return (
    <a
      href={`/api/v1/w/${workspace.id}/exports/${path}${separator}lang=${locale}`}
      download
      className="inline-block text-sm underline"
    >
      {t('csv', { what: label })}
    </a>
  );
}
