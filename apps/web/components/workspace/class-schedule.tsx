'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { ErrorMessage, SubmitButton } from '../form';

export const TIME_ZONE = 'Africa/Cairo';

interface Series {
  id: string;
  weekday: number;
  startTime: string;
  durationMinutes: number;
  startsOn: string;
  endsOn: string | null;
}

export interface Session {
  id: string;
  classId: string;
  className: string;
  localDate: string;
  startsAt: string;
  endsAt: string;
  cancelled: boolean;
  cancelReason: string | null;
}

interface Warning {
  className: string;
  startsAt: string;
}

/** Today's date in Cairo, as YYYY-MM-DD. */
export function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date());
}

/** A class's weekly schedule and upcoming sessions (REQ-SCHED-001, REQ-SCHED-002). */
export function ClassSchedule({
  base,
  classId,
  canManage,
}: {
  base: string;
  classId: string;
  canManage: boolean;
}) {
  const t = useTranslations('schedule');
  const format = useFormatter();
  const [series, setSeries] = useState<Series[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [warnings, setWarnings] = useState<Warning[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ series: Series[]; sessions: Session[] }>(
        `${base}/classes/${classId}/schedule`,
      );
      setSeries(data.series);
      setSessions(data.sessions);
    } catch (err) {
      setError(err);
    }
  }, [base, classId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const addSeries = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value;
    run(async () => {
      const result = await api<{ warnings: Warning[] }>(`${base}/classes/${classId}/series`, {
        method: 'POST',
        body: {
          weekday: Number(field('weekday')),
          startTime: field('startTime'),
          durationMinutes: Number(field('duration')),
          startsOn: field('startsOn') || cairoToday(),
        },
      });
      setWarnings(result.warnings);
    });
  };

  const cancel = (session: Session) => {
    const reason = window.prompt(t('cancelReason'));
    if (!reason || reason.trim().length < 3) return;
    run(() =>
      api(`${base}/sessions/${session.id}/cancel`, {
        method: 'POST',
        body: { reason: reason.trim() },
      }),
    );
  };

  const weekday = (day: number) => t(`weekdays.${String(day)}`);
  const when = (iso: string) =>
    format.dateTime(new Date(iso), {
      timeZone: TIME_ZONE,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
    });

  return (
    <section className="flex flex-col gap-3 rounded-2xl bg-surface p-6 shadow-sm">
      <h2 className="font-semibold">{t('title')}</h2>
      <ErrorMessage error={error} />
      {series.length === 0 ? <p className="text-sm text-muted">{t('noSeries')}</p> : null}
      <ul className="flex flex-col gap-1 text-sm">
        {series.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              {t('seriesLine', {
                day: weekday(s.weekday),
                time: s.startTime,
                minutes: s.durationMinutes,
              })}
              {s.endsOn ? ` · ${t('until', { date: s.endsOn })}` : ''}
            </span>
            {canManage && !s.endsOn ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api(`${base}/classes/${classId}/series/${s.id}/end`, {
                      method: 'POST',
                      body: { endsOn: cairoToday() },
                    }),
                  )
                }
                className="rounded-lg border px-2 py-0.5 text-xs"
              >
                {t('endSeries')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canManage ? (
        <form
          onSubmit={addSeries}
          noValidate
          className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4"
        >
          <label className="flex flex-col gap-1">
            {t('weekday')}
            <select name="weekday" defaultValue="6" className="rounded-lg border px-2 py-2">
              {[6, 0, 1, 2, 3, 4, 5].map((day) => (
                <option key={day} value={day}>
                  {weekday(day)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            {t('startTime')}
            <input
              name="startTime"
              type="time"
              defaultValue="17:00"
              dir="ltr"
              className="rounded-lg border px-2 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            {t('duration')}
            <input
              name="duration"
              type="number"
              min={15}
              max={480}
              step={15}
              defaultValue={120}
              dir="ltr"
              className="rounded-lg border px-2 py-2"
            />
          </label>
          <label className="flex flex-col gap-1">
            {t('startsOn')}
            <input name="startsOn" type="date" dir="ltr" className="rounded-lg border px-2 py-2" />
          </label>
          <div className="col-span-2 sm:col-span-4">
            <SubmitButton busy={busy}>{t('addSeries')}</SubmitButton>
          </div>
        </form>
      ) : null}
      {warnings.length > 0 ? (
        <div role="status" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-1 font-semibold">{t('overlapWarning')}</p>
          <ul>
            {warnings.map((w) => (
              <li key={`${w.className}-${w.startsAt}`}>
                {t('overlapLine', { name: w.className, when: when(w.startsAt) })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3 className="mt-2 text-sm font-semibold">{t('upcoming')}</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {sessions.slice(0, 10).map((session) => (
          <li key={session.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className={session.cancelled ? 'text-muted line-through' : ''}>
              {when(session.startsAt)}
            </span>
            {canManage ? (
              session.cancelled ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() => api(`${base}/sessions/${session.id}/restore`, { method: 'POST' }))
                  }
                  className="rounded-lg border px-2 py-0.5 text-xs"
                >
                  {t('restore')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => cancel(session)}
                  className="rounded-lg border px-2 py-0.5 text-xs text-red-700"
                >
                  {t('cancel')}
                </button>
              )
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
