'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { ErrorMessage, Field, SubmitButton } from '../form';

interface Session {
  id: string;
  reason: string;
  ticket: string;
  startedAt: string;
  expiresAt: string;
  active: boolean;
}

const DATE = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' } as const;

/**
 * Support sessions for one workspace (REQ-RBAC-003): read-only access with a reason and a
 * ticket, for at most 60 minutes. The owner teacher is told and sees everything viewed.
 */
export function SupportSessions({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('platform.support');
  const formatter = useFormatter();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const url = `/platform/workspaces/${workspaceId}/support-sessions`;

  const load = useCallback(async () => {
    try {
      setSessions((await api<{ sessions: Session[] }>(url)).sessions);
    } catch (err) {
      setError(err);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  const start = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    };
    setBusy(true);
    setError(null);
    api(url, {
      method: 'POST',
      body: { reason: text('reason'), ticket: text('ticket'), minutes: Number(text('minutes')) },
    })
      .then(() => {
        form.reset();
        return load();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const end = (id: string) => {
    setError(null);
    api(`/platform/support-sessions/${id}/end`, { method: 'POST' })
      .then(() => load())
      .catch(setError);
  };

  const active = sessions.find((s) => s.active);

  return (
    <section className="rounded-2xl bg-surface p-6 shadow-sm">
      <h2 className="mb-2 font-semibold">{t('title')}</h2>
      <p className="mb-4 text-sm text-muted">{t('explain')}</p>
      <ErrorMessage error={error} />
      {active ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 p-3 text-sm">
          <span>
            {t('activeUntil', { time: formatter.dateTime(new Date(active.expiresAt), DATE) })}
          </span>
          <Link href={`/w/${workspaceId}`} className="font-semibold underline">
            {t('open')}
          </Link>
          <button
            type="button"
            className="rounded-lg border px-3 py-1"
            onClick={() => end(active.id)}
          >
            {t('end')}
          </button>
        </div>
      ) : (
        <form onSubmit={start} noValidate className="mb-4">
          <Field label={t('reason')} name="reason" required minLength={5} maxLength={300} />
          <Field label={t('ticket')} name="ticket" required maxLength={60} dir="ltr" />
          <Field
            label={t('minutes')}
            name="minutes"
            type="number"
            min={1}
            max={60}
            defaultValue={30}
            dir="ltr"
            required
          />
          <SubmitButton busy={busy}>{t('start')}</SubmitButton>
        </form>
      )}
      <ul className="flex flex-col gap-1 text-xs text-muted">
        {sessions.map((s) => (
          <li key={s.id}>
            {formatter.dateTime(new Date(s.startedAt), DATE)} · {s.ticket} · {s.reason}
          </li>
        ))}
      </ul>
    </section>
  );
}
