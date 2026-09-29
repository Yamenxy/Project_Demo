'use client';

import { toWesternDigits } from '@lms/shared';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { ErrorMessage, Field, SubmitButton } from '../form';
import { absoluteUrl, ShareLink } from './share-link';
import { PublicPageSettings } from './public-page-settings';
import { StudentImport } from './student-import';
import { useWorkspace } from './workspace-shell';

interface Student {
  membershipId: string;
  userId: string | null;
  name: string;
  phoneE164?: string;
  platformCode: string | null;
  internalCode: string | null;
  status: 'active' | 'pending' | 'suspended';
  paused: boolean;
  managed: boolean;
  consent: 'not_required' | 'granted' | 'needed' | 'overdue' | null;
}

interface Joining {
  joinCode: string;
  autoApproveJoins: boolean;
}

const STATUS_STYLE: Record<Student['status'], string> = {
  active: 'bg-green-50 text-green-800',
  pending: 'bg-amber-50 text-amber-800',
  suspended: 'bg-red-50 text-red-800',
};

/** The Students tab, first part (D8, REQ-USER-003, REQ-USER-006). */
export function StudentsView() {
  const t = useTranslations('students');
  const { workspace, membership, permissions } = useWorkspace();
  const params = useSearchParams();
  const base = `/w/${workspace.id}`;
  const isOwner = membership.role === 'owner';
  const canReset = isOwner || permissions.includes('students.sessions_reset');
  const canManage = isOwner || permissions.includes('enrollment.manage');
  const canImport = isOwner || permissions.includes('students.import');

  const [filter, setFilter] = useState<'all' | 'pending' | 'consent'>(
    params.get('status') === 'pending'
      ? 'pending'
      : params.get('consent') === 'missing'
        ? 'consent'
        : 'all',
  );
  const [query, setQuery] = useState('');
  const [students, setStudents] = useState<Student[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [missingConsentCount, setMissingConsentCount] = useState(0);
  const [joining, setJoining] = useState<Joining | null>(null);
  const [share, setShare] = useState<{ url: string; message: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      if (isOwner) setJoining(await api<Joining>(`${base}/joining`));
      if (!canManage) return;
      const search = new URLSearchParams();
      if (filter === 'pending') search.set('status', 'pending');
      if (filter === 'consent') search.set('consent', 'missing');
      if (query.trim()) search.set('q', toWesternDigits(query.trim()));
      const data = await api<{
        students: Student[];
        pendingCount: number;
        missingConsentCount: number;
      }>(`${base}/students?${search.toString()}`);
      setStudents(data.students);
      setPendingCount(data.pendingCount);
      setMissingConsentCount(data.missingConsentCount);
    } catch (err) {
      setError(err);
    }
  }, [base, filter, query, isOwner, canManage]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const updateJoining = (change: Partial<{ rotateCode: boolean; autoApproveJoins: boolean }>) =>
    void run(async () => {
      setJoining(await api<Joining>(`${base}/joining`, { method: 'POST', body: change }));
    });

  const addManaged = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    void run(async () => {
      const { link } = await api<{ link: string }>(`${base}/students`, {
        method: 'POST',
        body: {
          name: value('name'),
          phone: toWesternDigits(value('phone')),
          internalCode: value('internalCode') || undefined,
        },
      });
      setShare({ url: absoluteUrl(link), message: t('claimMessage', { name: workspace.name }) });
      form.reset();
    });
  };

  const claimLink = (student: Student) =>
    void run(async () => {
      const { link } = await api<{ link: string }>(
        `${base}/students/${student.membershipId}/claim-link`,
        { method: 'POST' },
      );
      setShare({ url: absoluteUrl(link), message: t('claimMessage', { name: workspace.name }) });
    });

  const remove = (student: Student) => {
    const reason = window.prompt(t('removeReason', { name: student.name }));
    if (!reason || reason.trim().length < 3) return;
    void run(() =>
      api(`${base}/students/${student.membershipId}/remove`, {
        method: 'POST',
        body: { reason: reason.trim() },
      }),
    );
  };

  const paperConsent = (student: Student) => {
    const note = window.prompt(t('paperConsentNote', { name: student.name }));
    if (note === null) return;
    void run(async () => {
      await api(`${base}/students/${student.membershipId}/consent`, {
        method: 'POST',
        body: note.trim() ? { note: note.trim() } : {},
      });
      setNotice(t('paperConsentSaved', { name: student.name }));
    });
  };

  const resetDevices = (student: Student) =>
    void run(async () => {
      await api(`${base}/memberships/${student.membershipId}/devices/reset`, { method: 'POST' });
      setNotice(t('devicesReset', { name: student.name }));
    });

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />
      {notice ? (
        <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
          {notice}
        </p>
      ) : null}

      {isOwner && joining ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-1 font-semibold">{t('joiningTitle')}</h2>
          <p className="mb-3 text-sm text-muted">{t('joiningExplain')}</p>
          <p className="mb-3 text-center font-mono text-3xl tracking-widest" dir="ltr">
            {joining.joinCode}
          </p>
          <ShareLink
            url={absoluteUrl(`/join?code=${joining.joinCode}`)}
            message={t('joinMessage', { name: workspace.name })}
          />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={joining.autoApproveJoins}
                disabled={busy}
                onChange={(event) => updateJoining({ autoApproveJoins: event.target.checked })}
              />
              {t('autoApprove')}
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => updateJoining({ rotateCode: true })}
              className="rounded-lg border px-3 py-2 text-sm"
            >
              {t('rotateCode')}
            </button>
          </div>
        </section>
      ) : null}

      {isOwner ? <PublicPageSettings workspaceId={workspace.id} name={workspace.name} /> : null}

      {canManage ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`rounded-full px-3 py-1 text-sm ${filter === 'all' ? 'bg-brand text-brand-contrast' : 'border'}`}
            >
              {t('filterAll')}
            </button>
            <button
              type="button"
              onClick={() => setFilter('pending')}
              className={`rounded-full px-3 py-1 text-sm ${filter === 'pending' ? 'bg-brand text-brand-contrast' : 'border'}`}
            >
              {t('filterPending', { count: pendingCount })}
            </button>
            <button
              type="button"
              onClick={() => setFilter('consent')}
              className={`rounded-full px-3 py-1 text-sm ${filter === 'consent' ? 'bg-brand text-brand-contrast' : 'border'}`}
            >
              {t('filterConsent', { count: missingConsentCount })}
            </button>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
            />
          </div>

          {students.length === 0 ? <p className="text-muted">{t('empty')}</p> : null}
          <ul className="flex flex-col gap-2">
            {students.map((student) => (
              <li key={student.membershipId} className="rounded-xl bg-surface p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold">{student.name}</p>
                    <p className="text-sm text-muted">
                      {student.platformCode ? <Ltr>{student.platformCode}</Ltr> : null}
                      {student.internalCode ? (
                        <>
                          {' · '}
                          <Ltr>{student.internalCode}</Ltr>
                        </>
                      ) : null}
                      {student.phoneE164 ? (
                        <>
                          {' · '}
                          <Ltr>{student.phoneE164}</Ltr>
                        </>
                      ) : null}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[student.status]}`}
                    >
                      {t(`status.${student.status}`)}
                    </span>
                    {student.managed ? (
                      <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                        {t('managed')}
                      </span>
                    ) : null}
                    {student.consent === 'needed' || student.consent === 'overdue' ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${student.consent === 'overdue' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}
                      >
                        {t(`consent.${student.consent}`)}
                      </span>
                    ) : null}
                    {student.paused ? (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-800">
                        {t('paused')}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2 text-sm">
                  {student.status === 'pending' ? (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api(`${base}/students/${student.membershipId}/approve`, {
                              method: 'POST',
                            }),
                          )
                        }
                        className="rounded-lg bg-brand px-3 py-1 text-brand-contrast"
                      >
                        {t('approve')}
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(() =>
                            api(`${base}/students/${student.membershipId}/reject`, {
                              method: 'POST',
                            }),
                          )
                        }
                        className="rounded-lg border px-3 py-1"
                      >
                        {t('reject')}
                      </button>
                    </>
                  ) : null}
                  {student.managed ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => claimLink(student)}
                      className="rounded-lg border px-3 py-1"
                    >
                      {t('newClaimLink')}
                    </button>
                  ) : null}
                  {student.consent === 'needed' || student.consent === 'overdue' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => paperConsent(student)}
                      className="rounded-lg border px-3 py-1"
                    >
                      {t('paperConsent')}
                    </button>
                  ) : null}
                  {canReset && !student.managed && student.status === 'active' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => resetDevices(student)}
                      className="rounded-lg border px-3 py-1"
                    >
                      {t('resetDevices')}
                    </button>
                  ) : null}
                  {isOwner && student.status !== 'pending' ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => remove(student)}
                      className="rounded-lg border px-3 py-1 text-red-700"
                    >
                      {t('remove')}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canImport ? <StudentImport workspaceId={workspace.id} onDone={() => void load()} /> : null}

      {canManage ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-1 font-semibold">{t('addTitle')}</h2>
          <p className="mb-4 text-sm text-muted">{t('addExplain')}</p>
          <form onSubmit={addManaged} noValidate>
            <Field label={t('name')} name="name" required />
            <Field label={t('phone')} name="phone" type="tel" inputMode="tel" dir="ltr" required />
            <Field label={t('internalCode')} name="internalCode" dir="ltr" />
            <SubmitButton busy={busy}>{t('add')}</SubmitButton>
          </form>
          {share ? <ShareLink url={share.url} message={share.message} /> : null}
        </section>
      ) : null}
    </div>
  );
}
