'use client';

import { toWesternDigits } from '@lms/shared';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, usePathname, useRouter } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { ErrorMessage, Field, FormCard, SubmitButton } from '../form';

interface JoinResult {
  workspaceId: string;
  workspaceName: string;
  status: 'active' | 'pending' | 'suspended';
}

/** A student joins a teacher with the code the teacher shared (D8). */
export function JoinTeacher() {
  const t = useTranslations('joinTeacher');
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [result, setResult] = useState<JoinResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const initialCode = params.get('code') ?? '';

  useEffect(() => {
    api('/auth/me').catch((err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(`${pathname}?${params.toString()}`)}`);
      }
    });
  }, [router, pathname, params]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = (event.currentTarget.elements.namedItem('code') as HTMLInputElement).value;
    setBusy(true);
    setError(null);
    try {
      setResult(
        await api<JoinResult>('/join', {
          method: 'POST',
          body: { code: toWesternDigits(code).trim().toUpperCase() },
        }),
      );
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    return (
      <FormCard title={t('title')}>
        <p className="mb-6">
          {result.status === 'active'
            ? t('joined', { name: result.workspaceName })
            : t('pending', { name: result.workspaceName })}
        </p>
        {result.status === 'active' ? (
          <Link
            href={`/w/${result.workspaceId}`}
            className="block rounded-lg bg-brand px-4 py-3 text-center font-semibold text-brand-contrast"
          >
            {t('open')}
          </Link>
        ) : (
          <Link href="/account" className="text-sm underline">
            {t('backToAccount')}
          </Link>
        )}
      </FormCard>
    );
  }

  return (
    <FormCard title={t('title')}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <ErrorMessage error={error} />
        <p className="mb-4 text-muted">{t('explain')}</p>
        <Field
          label={t('code')}
          name="code"
          dir="ltr"
          autoCapitalize="characters"
          defaultValue={initialCode}
          required
        />
        <SubmitButton busy={busy}>{t('submit')}</SubmitButton>
      </form>
    </FormCard>
  );
}
