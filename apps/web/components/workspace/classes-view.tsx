'use client';

import { toWesternDigits } from '@lms/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { ErrorMessage, Field, SubmitButton } from '../form';
import { ClassSchedule } from './class-schedule';
import { useWorkspace } from './workspace-shell';

interface ClassSummary {
  id: string;
  name: string;
  responsible: { membershipId: string; name: string };
  studentCount: number;
  archived: boolean;
}

interface ClassStudent {
  membershipId: string;
  name: string;
  platformCode: string | null;
  internalCode: string | null;
  paused: boolean;
}

interface Staff {
  membershipId: string;
  name: string;
  role: string;
  status: string;
}

/** The classes list (REQ-CLASS-001). */
export function ClassesView() {
  const t = useTranslations('classes');
  const { workspace, membership } = useWorkspace();
  const isOwner = membership.role === 'owner';
  const base = `/w/${workspace.id}`;
  const [archived, setArchived] = useState(false);
  const [classes, setClasses] = useState<ClassSummary[]>([]);
  const [teachers, setTeachers] = useState<Staff[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ classes: ClassSummary[] }>(
        `${base}/classes${archived ? '?archived=true' : ''}`,
      );
      setClasses(data.classes);
    } catch (err) {
      setError(err);
    }
  }, [base, archived]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isOwner) return;
    api<{ staff: Staff[] }>(`${base}/staff`)
      .then((data) =>
        setTeachers(data.staff.filter((m) => m.role === 'class_teacher' && m.status === 'active')),
      )
      .catch(() => setTeachers([]));
  }, [base, isOwner]);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    const responsible = (form.elements.namedItem('responsible') as HTMLSelectElement | null)?.value;
    setBusy(true);
    setError(null);
    api(`${base}/classes`, {
      method: 'POST',
      body: { name, ...(responsible ? { responsibleMembershipId: responsible } : {}) },
    })
      .then(() => {
        form.reset();
        return load();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <button
          type="button"
          onClick={() => setArchived(!archived)}
          className="rounded-full border px-3 py-1 text-sm"
        >
          {archived ? t('showActive') : t('showArchived')}
        </button>
      </div>
      <ErrorMessage error={error} />
      {classes.length === 0 ? <p className="text-muted">{t('empty')}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {classes.map((c) => (
          <li key={c.id}>
            <Link
              href={`${base}/classes/${c.id}`}
              className="block rounded-2xl bg-surface p-5 shadow-sm hover:ring-2 hover:ring-brand"
            >
              <p className="font-semibold">{c.name}</p>
              <p className="text-sm text-muted">{t('responsible', { name: c.responsible.name })}</p>
              <p className="text-sm text-muted">{t('studentCount', { count: c.studentCount })}</p>
            </Link>
          </li>
        ))}
      </ul>

      {isOwner && !archived ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-4 font-semibold">{t('createTitle')}</h2>
          <form onSubmit={create} noValidate>
            <Field label={t('name')} name="name" required />
            <div className="mb-4 flex flex-col gap-1">
              <label htmlFor="class-responsible" className="text-sm font-semibold">
                {t('responsibleLabel')}
              </label>
              <select
                id="class-responsible"
                name="responsible"
                className="rounded-lg border border-gray-300 bg-white px-3 py-3"
              >
                <option value="">{t('me')}</option>
                {teachers.map((teacher) => (
                  <option key={teacher.membershipId} value={teacher.membershipId}>
                    {teacher.name}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton busy={busy}>{t('create')}</SubmitButton>
          </form>
        </section>
      ) : null}
    </div>
  );
}

/** One class: its students, adding by search, removing and transferring. */
export function ClassView({ classId }: { classId: string }) {
  const t = useTranslations('classes');
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const isOwner = membership.role === 'owner';
  const canManage = isOwner || permissions.includes('enrollment.manage');
  const [detail, setDetail] = useState<(ClassSummary & { students: ClassStudent[] }) | null>(null);
  const [others, setOthers] = useState<ClassSummary[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ membershipId: string; name: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api(`${base}/classes/${classId}`));
      const list = await api<{ classes: ClassSummary[] }>(`${base}/classes`);
      setOthers(list.classes.filter((c) => c.id !== classId));
    } catch (err) {
      setError(err);
    }
  }, [base, classId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canManage || query.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      api<{ students: { membershipId: string; name: string }[] }>(
        `${base}/classes/${classId}/candidates?q=${encodeURIComponent(toWesternDigits(query.trim()))}`,
      )
        .then((data) => setFound(data.students))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [base, classId, query, canManage]);

  const run = (path: string, body?: object) => {
    setBusy(true);
    setError(null);
    api(`${base}/classes/${classId}${path}`, { method: 'POST', ...(body ? { body } : {}) })
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  if (!detail) return <ErrorMessage error={error} />;
  const enrolled = new Set(detail.students.map((s) => s.membershipId));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`${base}/classes`} className="text-sm underline">
          {t('back')}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{detail.name}</h1>
        <p className="text-sm text-muted">{t('responsible', { name: detail.responsible.name })}</p>
        {isOwner ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => run('', { archived: !detail.archived })}
            className="mt-2 rounded-lg border px-3 py-1 text-sm"
          >
            {detail.archived ? t('restore') : t('archive')}
          </button>
        ) : null}
      </div>
      <ErrorMessage error={error} />

      <ClassSchedule
        base={base}
        classId={classId}
        canManage={!detail.archived && (isOwner || permissions.includes('schedule.manage'))}
      />

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t('studentCount', { count: detail.students.length })}</h2>
        <ul className="flex flex-col gap-2">
          {detail.students.map((student) => (
            <li
              key={student.membershipId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-3 shadow-sm"
            >
              <div>
                <p className="font-semibold">{student.name}</p>
                <p className="text-xs text-muted">
                  {student.platformCode ? <Ltr>{student.platformCode}</Ltr> : null}
                  {student.paused ? ` · ${t('paused')}` : ''}
                </p>
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2 text-sm">
                  {others.length > 0 ? (
                    <select
                      aria-label={t('transferTo', { name: student.name })}
                      defaultValue=""
                      disabled={busy}
                      onChange={(event) =>
                        event.target.value &&
                        run(`/students/${student.membershipId}/transfer`, {
                          toClassId: event.target.value,
                        })
                      }
                      className="rounded-lg border px-2 py-1"
                    >
                      <option value="">{t('transfer')}</option>
                      {others.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(`/students/${student.membershipId}/remove`)}
                    className="rounded-lg border px-3 py-1 text-red-700"
                  >
                    {t('remove')}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {canManage && !detail.archived ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-3 font-semibold">{t('addTitle')}</h2>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('search')}
            aria-label={t('search')}
            className="mb-3 w-full rounded-lg border px-3 py-2"
          />
          <ul className="flex flex-col gap-1">
            {found
              .filter((s) => !enrolled.has(s.membershipId))
              .map((s) => (
                <li key={s.membershipId} className="flex items-center justify-between gap-2">
                  <span>{s.name}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run('/students', { membershipIds: [s.membershipId] })}
                    className="rounded-lg bg-brand px-3 py-1 text-sm text-brand-contrast"
                  >
                    {t('add')}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
