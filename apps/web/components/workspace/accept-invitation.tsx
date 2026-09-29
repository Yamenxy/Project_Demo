'use client';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { ErrorMessage, FormCard } from '../form';

/** Where a staff invitation link lands (REQ-USER-005). Signing in comes back here. */
export function AcceptInvitation() {
  const t = useTranslations('join');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const workspaceId = params.get('w') ?? '';
  const token = params.get('t') ?? '';
  const [preview, setPreview] = useState<{ workspaceName: string; role: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ workspaceName: string; role: string }>(
      `/invitations/preview?w=${encodeURIComponent(workspaceId)}&t=${encodeURIComponent(token)}`,
    ).then(setPreview, (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        const next = `${pathname}?${params.toString()}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      } else setError(err);
    });
  }, [workspaceId, token, router, pathname, params]);

  const accept = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('/invitations/accept', { method: 'POST', body: { workspaceId, token } });
      router.push(`/w/${workspaceId}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormCard title={t('title')}>
      <ErrorMessage error={error} />
      {preview ? (
        <>
          <p className="mb-6">
            {t('invitedAs', { workspace: preview.workspaceName, role: t(`roles.${preview.role}`) })}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void accept()}
            className="w-full rounded-lg bg-brand px-4 py-3 font-semibold text-brand-contrast disabled:opacity-60"
          >
            {t('accept')}
          </button>
        </>
      ) : null}
    </FormCard>
  );
}
