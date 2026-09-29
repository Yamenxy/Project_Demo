'use client';

import { toWesternDigits } from '@lms/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { ErrorMessage, Field, FormCard, SubmitButton } from '../form';

export interface ConsentStatus {
  state: 'not_required' | 'granted' | 'needed' | 'overdue';
  dueAt: string | null;
  dateOfBirth: string | null;
  guardianPhone: string | null;
  method: 'otp' | 'paper' | null;
  version: string;
}

/** Guardian consent for students under 18 (REQ-PRIV-001, OQ-09). */
export function ConsentView() {
  const t = useTranslations('consent');
  const format = useFormatter();
  const router = useRouter();
  const [status, setStatus] = useState<ConsentStatus | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await api<ConsentStatus>('/auth/consent'));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login?next=/consent');
      else setError(err);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const saveDetails = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | null)?.value.trim() ?? '';
    const dateOfBirth = field('dateOfBirth');
    const guardianPhone = field('guardianPhone');
    void run(async () => {
      const next = await api<ConsentStatus>('/auth/consent/details', {
        method: 'POST',
        body: {
          ...(dateOfBirth && !status?.dateOfBirth ? { dateOfBirth } : {}),
          ...(guardianPhone ? { guardianPhone: toWesternDigits(guardianPhone) } : {}),
        },
      });
      setStatus(next);
      setSent(false);
    });
  };

  const sendCode = () =>
    void run(async () => {
      await api('/auth/consent/send-code', { method: 'POST' });
      setSent(true);
    });

  const verify = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = (event.currentTarget.elements.namedItem('code') as HTMLInputElement).value;
    void run(async () => {
      setStatus(
        await api<ConsentStatus>('/auth/consent/verify', {
          method: 'POST',
          body: { code: toWesternDigits(code) },
        }),
      );
    });
  };

  if (!status) {
    return (
      <FormCard title={t('title')}>
        <ErrorMessage error={error} />
      </FormCard>
    );
  }

  if (status.state === 'granted' || status.state === 'not_required') {
    return (
      <FormCard title={t('title')}>
        <p role="status" className="mb-6">
          {status.state === 'granted' ? t('granted') : t('notRequired')}
        </p>
        <Link href="/account" className="text-sm underline">
          {t('backToAccount')}
        </Link>
      </FormCard>
    );
  }

  return (
    <FormCard title={t('title')}>
      <ErrorMessage error={error} />
      <p className="mb-2">{t('explain')}</p>
      {status.dueAt ? (
        <p
          className={`mb-4 rounded-lg px-3 py-2 text-sm ${status.state === 'overdue' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}
        >
          {status.state === 'overdue'
            ? t('overdue')
            : t('dueBy', { date: format.dateTime(new Date(status.dueAt), { dateStyle: 'long' }) })}
        </p>
      ) : null}

      <form onSubmit={saveDetails} noValidate className="mb-4">
        {status.dateOfBirth ? (
          <p className="mb-4 text-sm">
            {t('dateOfBirthIs')} <Ltr>{status.dateOfBirth}</Ltr>
          </p>
        ) : (
          <Field label={t('dateOfBirth')} name="dateOfBirth" type="date" dir="ltr" required />
        )}
        <Field
          label={t('guardianPhone')}
          name="guardianPhone"
          type="tel"
          inputMode="tel"
          dir="ltr"
          defaultValue={status.guardianPhone ? `0${status.guardianPhone.slice(3)}` : ''}
          hint={t('guardianPhoneHint')}
          required
        />
        <SubmitButton busy={busy}>{t('save')}</SubmitButton>
      </form>

      {status.dateOfBirth && status.guardianPhone ? (
        <div className="flex flex-col gap-3 border-t pt-4">
          <button
            type="button"
            disabled={busy}
            onClick={sendCode}
            className="rounded-lg border px-4 py-3 font-semibold"
          >
            {sent ? t('resend') : t('sendCode')}
          </button>
          {sent ? (
            <form onSubmit={verify} noValidate>
              <p className="mb-3 text-sm">{t('codeSent')}</p>
              <Field
                label={t('code')}
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                required
              />
              <SubmitButton busy={busy}>{t('confirm')}</SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}
      <p className="mt-6 text-sm text-muted">{t('paperOption')}</p>
    </FormCard>
  );
}
