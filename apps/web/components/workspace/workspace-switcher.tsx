'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter } from '../../i18n/navigation';
import { api } from '../../lib/api';

interface MyWorkspace {
  workspaceId: string;
  name: string;
  status: string;
}

/** Moves between the workspaces the user belongs to (review MISS-05). Hidden with only one. */
export function WorkspaceSwitcher({ currentId }: { currentId: string }) {
  const t = useTranslations('workspace');
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<MyWorkspace[]>([]);

  useEffect(() => {
    api<{ workspaces: MyWorkspace[] }>('/me/workspaces')
      .then((data) => setWorkspaces(data.workspaces.filter((w) => w.status === 'active')))
      .catch(() => setWorkspaces([]));
  }, []);

  if (workspaces.length < 2) return null;
  return (
    <select
      aria-label={t('switchWorkspace')}
      value={currentId}
      onChange={(event) => router.push(`/w/${event.target.value}`)}
      className="max-w-48 rounded-lg border bg-white px-2 py-1 text-sm"
    >
      {workspaces.map((w) => (
        <option key={w.workspaceId} value={w.workspaceId}>
          {w.name}
        </option>
      ))}
    </select>
  );
}
