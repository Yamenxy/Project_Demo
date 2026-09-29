'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { ErrorMessage, Field, SubmitButton } from '../form';
import { cairoToday, TIME_ZONE, type Session } from './class-schedule';
import { useWorkspace } from './workspace-shell';

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The next two weeks of sessions, for staff and students; days off for the owner. */
export function AgendaView() {
  const t = useTranslations('schedule');
  const format = useFormatter();
  const { workspace, permissions, membership } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const canSkip = membership.role === 'owner';
  const staff = membership.role === 'owner' || permissions.includes('attendance.mark');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [skips, setSkips] = useState<{ date: string; reason: string | null }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const from = cairoToday();
      const data = await api<{ sessions: Session[] }>(
        `${base}/sessions?from=${from}&to=${addDays(from, 14)}`,
      );
      setSessions(data.sessions);
      if (canSkip) {
        setSkips((await api<{ dates: typeof skips }>(`${base}/skip-dates`)).dates);
      }
    } catch (err) {
      setError(err);
    }
  }, [base, canSkip]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const addSkip = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    run(() =>
      api(`${base}/skip-dates`, {
        method: 'POST',
        body: { date: field('date'), ...(field('reason') ? { reason: field('reason') } : {}) },
      }).then(() => form.reset()),
    );
  };

  const days = [...new Set(sessions.map((s) => s.localDate))];
  const time = (iso: string) =>
    format.dateTime(new Date(iso), { timeZone: TIME_ZONE, hour: 'numeric', minute: '2-digit' });
  const day = (date: string) =>
    format.dateTime(new Date(`${date}T12:00:00Z`), {
      timeZone: TIME_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('agendaTitle')}</h1>
      <ErrorMessage error={error} />
      {sessions.length === 0 ? <p className="text-muted">{t('noSessions')}</p> : null}
      {days.map((date) => (
        <section key={date}>
          <h2 className="mb-2 text-sm font-semibold text-muted">{day(date)}</h2>
          <ul className="flex flex-col gap-2">
            {sessions
              .filter((s) => s.localDate === date)
              .map((s) => (
                <li
                  key={s.id}
                  className={`rounded-xl bg-surface p-3 shadow-sm ${s.cancelled ? 'opacity-60' : ''}`}
                >
                  {staff && !s.cancelled ? (
                    <Link
                      href={`${base}/sessions/${s.id}`}
                      className="font-semibold text-brand underline"
                    >
                      {s.className}
                    </Link>
                  ) : (
                    <p className={`font-semibold ${s.cancelled ? 'line-through' : ''}`}>
                      {s.className}
                    </p>
                  )}
                  <p className="text-sm text-muted">
                    {t('timeRange', { from: time(s.startsAt), to: time(s.endsAt) })}
                    {s.cancelled ? ` · ${t('cancelled')}` : ''}
                  </p>
                </li>
              ))}
          </ul>
        </section>
      ))}

      {canSkip && permissions.includes('schedule.manage') ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-1 font-semibold">{t('skipTitle')}</h2>
          <p className="mb-3 text-sm text-muted">{t('skipExplain')}</p>
          <ul className="mb-4 flex flex-col gap-1 text-sm">
            {skips.map((s) => (
              <li key={s.date} className="flex items-center justify-between gap-2">
                <span>
                  {day(s.date)}
                  {s.reason ? ` · ${s.reason}` : ''}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() => api(`${base}/skip-dates/${s.date}`, { method: 'DELETE' }))
                  }
                  className="rounded-lg border px-2 py-0.5 text-xs"
                >
                  {t('removeSkip')}
                </button>
              </li>
            ))}
          </ul>
          <form onSubmit={addSkip} noValidate>
            <Field label={t('skipDate')} name="date" type="date" dir="ltr" required />
            <Field label={t('skipReason')} name="reason" />
            <SubmitButton busy={busy}>{t('addSkip')}</SubmitButton>
          </form>
        </section>
      ) : null}
    </div>
  );
}
