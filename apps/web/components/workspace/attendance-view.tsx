'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { ErrorMessage } from '../form';
import { TIME_ZONE } from './class-schedule';
import { useWorkspace } from './workspace-shell';

export type Status = 'present' | 'late' | 'absent' | 'excused';
const STATUSES: Status[] = ['present', 'late', 'absent', 'excused'];

export interface RosterStudent {
  membershipId: string;
  name: string;
  platformCode: string | null;
  paused: boolean;
  status: Status | null;
}

export interface Roster {
  session: {
    id: string;
    classId: string;
    className: string;
    startsAt: string;
    endsAt: string;
    cancelled: boolean;
    locked: boolean;
  };
  students: RosterStudent[];
  others: Omit<RosterStudent, 'status'>[];
}

const STYLE: Record<Status, string> = {
  present: 'bg-green-600 text-white',
  late: 'bg-amber-500 text-white',
  absent: 'bg-red-600 text-white',
  excused: 'bg-gray-500 text-white',
};

/** Taking attendance by hand for one session (REQ-ATT-001, REQ-ATT-002). */
export function AttendanceView({ sessionId }: { sessionId: string }) {
  const t = useTranslations('attendance');
  const format = useFormatter();
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const [roster, setRoster] = useState<Roster | null>(null);
  const [changes, setChanges] = useState<Record<string, Status>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRoster(await api<Roster>(`${base}/sessions/${sessionId}/attendance`));
      setChanges({});
    } catch (err) {
      setError(err);
    }
  }, [base, sessionId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!roster) return <ErrorMessage error={error} />;

  const statusOf = (s: RosterStudent) => changes[s.membershipId] ?? s.status;
  const set = (membershipId: string, status: Status) => {
    setSaved(false);
    setChanges((c) => ({ ...c, [membershipId]: status }));
  };
  const allPresent = () => {
    const next: Record<string, Status> = { ...changes };
    for (const s of roster.students) if (!statusOf(s)) next[s.membershipId] = 'present';
    setSaved(false);
    setChanges(next);
  };

  const save = () => {
    const records = Object.entries(changes).map(([membershipId, status]) => ({
      membershipId,
      status,
    }));
    if (records.length === 0) return;
    let reason: string | undefined;
    if (roster.session.locked) {
      reason = window.prompt(t('lateReason')) ?? undefined;
      if (!reason || reason.trim().length < 3) return;
    }
    setBusy(true);
    setError(null);
    api(`${base}/sessions/${sessionId}/attendance`, {
      method: 'POST',
      body: { records, ...(reason ? { reason: reason.trim() } : {}) },
    })
      .then(async () => {
        await load();
        setSaved(true);
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const count = (status: Status) => roster.students.filter((s) => statusOf(s) === status).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={`${base}/classes/${roster.session.classId}`} className="text-sm underline">
          {roster.session.className}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">
          {format.dateTime(new Date(roster.session.startsAt), {
            timeZone: TIME_ZONE,
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: 'numeric',
            minute: '2-digit',
          })}
        </h1>
        <p className="text-sm text-muted">
          {STATUSES.map((s) => t('countLine', { label: t(`status.${s}`), count: count(s) })).join(
            ' · ',
          )}
        </p>
      </div>
      <ErrorMessage error={error} />
      {roster.session.cancelled ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('cancelled')}</p>
      ) : null}
      {roster.session.locked ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('locked')}</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`${base}/sessions/${sessionId}/scan`}
          className="rounded-lg bg-brand px-4 py-2 font-semibold text-brand-contrast"
        >
          {t('scan')}
        </Link>
        <button
          type="button"
          disabled={roster.session.cancelled}
          onClick={allPresent}
          className="rounded-lg border px-4 py-2"
        >
          {t('allPresent')}
        </button>
      </div>

      <ul className="flex flex-col gap-2">
        {roster.students.map((student) => (
          <li key={student.membershipId} className="rounded-xl bg-surface p-3 shadow-sm">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{student.name}</p>
              <p className="text-xs text-muted">
                {student.platformCode ? <Ltr>{student.platformCode}</Ltr> : null}
                {student.paused ? ` · ${t('paused')}` : ''}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-1" role="group" aria-label={student.name}>
              {STATUSES.map((status) => (
                <button
                  key={status}
                  type="button"
                  aria-pressed={statusOf(student) === status}
                  disabled={roster.session.cancelled}
                  onClick={() => set(student.membershipId, status)}
                  className={`rounded-lg px-2 py-2 text-sm ${statusOf(student) === status ? STYLE[status] : 'border'}`}
                >
                  {t(`status.${status}`)}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {roster.students.length === 0 ? <p className="text-muted">{t('noStudents')}</p> : null}

      <div className="sticky bottom-0 bg-[var(--background,white)] py-3">
        <button
          type="button"
          disabled={busy || Object.keys(changes).length === 0}
          onClick={save}
          className="w-full rounded-lg bg-brand px-4 py-3 font-semibold text-brand-contrast disabled:opacity-50"
        >
          {t('save', { count: Object.keys(changes).length })}
        </button>
        {saved ? (
          <p role="status" className="mt-2 text-center text-sm text-brand">
            {t('saved')}
          </p>
        ) : null}
      </div>
    </div>
  );
}
