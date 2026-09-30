'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { ErrorMessage, Field, SubmitButton } from '../form';

const GRACE_DAYS = 14;
const DAY = 24 * 3600 * 1000;

/**
 * The person's own data (REQ-PRIV-003): download it, correct their name, and delete the account
 * with 14 days to change their mind.
 */
export function MyDataSection({
  nameAr,
  deletionRequestedAt,
  onChange,
}: {
  nameAr: string;
  deletionRequestedAt: string | null;
  onChange: () => Promise<void>;
}) {
  const t = useTranslations('myData');
  const formatter = useFormatter();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => onChange())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const rename = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get('nameAr');
    setSaved(false);
    run(async () => {
      await api('/me/profile', {
        method: 'POST',
        body: { nameAr: typeof value === 'string' ? value : '' },
      });
      setSaved(true);
    });
  };

  const deleteAfter = deletionRequestedAt
    ? new Date(new Date(deletionRequestedAt).getTime() + GRACE_DAYS * DAY)
    : null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-surface p-6 shadow-sm">
      <h2 className="font-semibold">{t('title')}</h2>
      <ErrorMessage error={error} />
      <a href="/api/v1/me/data-export" download className="self-start text-sm underline">
        {t('download')}
      </a>
      <form onSubmit={rename} noValidate>
        <Field label={t('name')} name="nameAr" defaultValue={nameAr} required minLength={2} />
        <SubmitButton busy={busy}>{t('saveName')}</SubmitButton>
        {saved ? (
          <p role="status" className="mt-2 text-sm text-muted">
            {t('saved')}
          </p>
        ) : null}
      </form>
      {deleteAfter ? (
        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            {t('pending', {
              date: formatter.dateTime(deleteAfter, {
                dateStyle: 'long',
                timeZone: 'Africa/Cairo',
              }),
            })}
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => api('/me/deletion/cancel', { method: 'POST' }))}
            className="mt-2 rounded-lg border px-3 py-1"
          >
            {t('cancel')}
          </button>
        </div>
      ) : confirming ? (
        <div className="rounded-lg border border-red-200 p-3 text-sm">
          <p className="mb-2">{t('confirm', { days: GRACE_DAYS })}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api('/me/deletion', { method: 'POST' });
                  setConfirming(false);
                })
              }
              className="rounded-lg bg-red-700 px-3 py-1 text-white"
            >
              {t('confirmDelete')}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border px-3 py-1"
            >
              {t('keep')}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="self-start text-sm text-red-700 underline"
        >
          {t('delete')}
        </button>
      )}
    </section>
  );
}
