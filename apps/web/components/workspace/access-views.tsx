'use client';

import { toWesternDigits } from '@lms/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { ErrorMessage, Field, SubmitButton } from '../form';
import type { StudentLesson } from './lessons-view';
import { useWorkspace } from './workspace-shell';

interface Group {
  id: string;
  name: string;
  archived: boolean;
  lessonIds: string[];
  members: { membershipId: string; name: string }[];
}

interface CourseWithLessons {
  id: string;
  title: string;
  lessons: { id: string; title: string; published: boolean }[];
}

/** Access groups (REQ-CONTENT-006, REQ-CONTENT-007). */
export function GroupsView() {
  const t = useTranslations('access');
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const [groups, setGroups] = useState<Group[]>([]);
  const [courses, setCourses] = useState<CourseWithLessons[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<{ membershipId: string; name: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setGroups((await api<{ groups: Group[] }>(`${base}/access-groups`)).groups);
      const list = (await api<{ courses: { id: string }[] }>(`${base}/courses`)).courses;
      setCourses(
        await Promise.all(list.map((c) => api<CourseWithLessons>(`${base}/courses/${c.id}`))),
      );
      setClasses(
        (await api<{ classes: { id: string; name: string }[] }>(`${base}/classes`)).classes,
      );
    } catch (err) {
      setError(err);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      api<{ students: { membershipId: string; name: string }[] }>(
        `${base}/access-groups/students?q=${encodeURIComponent(toWesternDigits(query.trim()))}`,
      )
        .then((data) => setFound(data.students))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [base, query]);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const name = (form.elements.namedItem('name') as HTMLInputElement).value;
    run(() =>
      api(`${base}/access-groups`, { method: 'POST', body: { name } }).then(() => form.reset()),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('groupsTitle')}</h1>
      <p className="text-sm text-muted">{t('groupsExplain')}</p>
      <ErrorMessage error={error} />
      <ul className="flex flex-col gap-3">
        {groups.map((g) => (
          <li key={g.id} className="rounded-2xl bg-surface p-4 shadow-sm">
            <button
              type="button"
              onClick={() => setOpen(open === g.id ? null : g.id)}
              className="flex w-full items-center justify-between text-start"
              aria-expanded={open === g.id}
            >
              <span className="font-semibold">{g.name}</span>
              <span className="text-sm text-muted">
                {t('groupCounts', { lessons: g.lessonIds.length, students: g.members.length })}
              </span>
            </button>
            {open === g.id ? (
              <div className="mt-4 flex flex-col gap-4">
                <fieldset>
                  <legend className="mb-2 text-sm font-semibold">{t('lessons')}</legend>
                  {courses.map((c) => (
                    <div key={c.id} className="mb-2">
                      <p className="text-xs text-muted">{c.title}</p>
                      {c.lessons.map((l) => (
                        <label key={l.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="size-4"
                            checked={g.lessonIds.includes(l.id)}
                            disabled={busy}
                            onChange={(event) =>
                              run(() =>
                                api(`${base}/access-groups/${g.id}/lessons`, {
                                  method: 'POST',
                                  body: event.target.checked ? { add: [l.id] } : { remove: [l.id] },
                                }),
                              )
                            }
                          />
                          {l.title}
                          {l.published ? '' : ` (${t('draft')})`}
                        </label>
                      ))}
                    </div>
                  ))}
                </fieldset>
                <div>
                  <p className="mb-2 text-sm font-semibold">{t('students')}</p>
                  <ul className="mb-2 flex flex-col gap-1 text-sm">
                    {g.members.map((m) => (
                      <li key={m.membershipId} className="flex items-center justify-between">
                        <span>{m.name}</span>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              api(`${base}/access-groups/${g.id}/members`, {
                                method: 'POST',
                                body: { remove: [m.membershipId] },
                              }),
                            )
                          }
                          className="rounded-lg border px-2 py-0.5 text-xs"
                        >
                          {t('removeStudent')}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t('findStudent')}
                    aria-label={t('findStudent')}
                    className="mb-2 w-full rounded-lg border px-3 py-2 text-sm"
                  />
                  <ul className="flex flex-col gap-1 text-sm">
                    {found
                      .filter((s) => !g.members.some((m) => m.membershipId === s.membershipId))
                      .map((s) => (
                        <li key={s.membershipId} className="flex items-center justify-between">
                          <span>{s.name}</span>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              run(() =>
                                api(`${base}/access-groups/${g.id}/members`, {
                                  method: 'POST',
                                  body: { add: [s.membershipId] },
                                }),
                              )
                            }
                            className="rounded-lg bg-brand px-2 py-0.5 text-xs text-brand-contrast"
                          >
                            {t('addStudent')}
                          </button>
                        </li>
                      ))}
                  </ul>
                  {classes.length > 0 ? (
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      {t('addClass')}
                      <select
                        defaultValue=""
                        disabled={busy}
                        onChange={(event) =>
                          event.target.value &&
                          run(() =>
                            api(`${base}/access-groups/${g.id}/add-class`, {
                              method: 'POST',
                              body: { classId: event.target.value },
                            }),
                          )
                        }
                        className="rounded-lg border px-2 py-1"
                      >
                        <option value="">{t('chooseClass')}</option>
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(() =>
                      api(`${base}/access-groups/${g.id}`, {
                        method: 'POST',
                        body: { archived: true },
                      }),
                    )
                  }
                  className="self-start rounded-lg border px-3 py-1 text-sm"
                >
                  {t('archiveGroup')}
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">{t('newGroup')}</h2>
        <form onSubmit={create} noValidate>
          <Field label={t('groupName')} name="name" required />
          <SubmitButton busy={busy}>{t('create')}</SubmitButton>
        </form>
      </section>
    </div>
  );
}

/** One student's access (OD-03): pause, groups, and each lesson with why it's open or closed. */
export function StudentAccessView({ membershipId }: { membershipId: string }) {
  const t = useTranslations('access');
  const tl = useTranslations('lessons');
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const isOwner = membership.role === 'owner';
  const canPause = isOwner || permissions.includes('access.pause');
  const [view, setView] = useState<{
    paused: boolean;
    pauseReason: string | null;
    groups: { id: string; name: string }[];
    rules: { lessonId: string; kind: 'grant' | 'block' }[];
    lessons: StudentLesson[];
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setView(await api(`${base}/access/students/${membershipId}`));
    } catch (err) {
      setError(err);
    }
  }, [base, membershipId]);

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

  if (!view) return <ErrorMessage error={error} />;
  const ruleOf = (lessonId: string) =>
    view.rules.find((r) => r.lessonId === lessonId)?.kind ?? 'none';

  return (
    <div className="flex flex-col gap-4">
      <Link href={`${base}/students`} className="text-sm underline">
        {t('backToStudents')}
      </Link>
      <h1 className="text-xl font-semibold">{t('studentTitle')}</h1>
      <ErrorMessage error={error} />
      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <p className="mb-2">{view.paused ? t('isPaused') : t('notPaused')}</p>
        {canPause ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              const reason = view.paused ? null : window.prompt(t('pauseReason'));
              if (reason === null && !view.paused) return;
              run(() =>
                api(`${base}/access/pause`, {
                  method: 'POST',
                  body: {
                    membershipIds: [membershipId],
                    paused: !view.paused,
                    ...(reason ? { reason } : {}),
                  },
                }),
              );
            }}
            className="rounded-lg border px-3 py-1 text-sm"
          >
            {view.paused ? t('resume') : t('pause')}
          </button>
        ) : null}
        <p className="mt-3 text-sm text-muted">
          {t('inGroups', { names: view.groups.map((g) => g.name).join('، ') || '—' })}
        </p>
      </section>
      <ul className="flex flex-col gap-2">
        {view.lessons.map((l) => (
          <li
            key={l.lessonId}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-3 text-sm shadow-sm"
          >
            <div>
              <p className="font-semibold">{l.title}</p>
              <p className="text-xs text-muted">
                {l.courseTitle} ·{' '}
                {l.decision.allowed
                  ? l.decision.via === 'group'
                    ? t('viaGroup', { names: l.decision.groups.join('، ') })
                    : t('viaGrant')
                  : tl(`denied.${l.decision.reason}`)}
              </p>
            </div>
            <select
              aria-label={t('ruleFor', { title: l.title })}
              value={ruleOf(l.lessonId)}
              disabled={busy}
              onChange={(event) =>
                run(() =>
                  api(`${base}/access/rules`, {
                    method: 'POST',
                    body: {
                      membershipIds: [membershipId],
                      lessonIds: [l.lessonId],
                      rule: event.target.value,
                    },
                  }),
                )
              }
              className="rounded-lg border px-2 py-1"
            >
              <option value="none">{t('ruleNone')}</option>
              <option value="grant">{t('ruleGrant')}</option>
              <option value="block">{t('ruleBlock')}</option>
            </select>
          </li>
        ))}
      </ul>
      {isOwner ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            const confirmation = window.prompt(t('removeAllPrompt'));
            if (!confirmation) return;
            run(() =>
              api(`${base}/access/students/${membershipId}/remove-all`, {
                method: 'POST',
                body: { confirmation },
              }),
            );
          }}
          className="self-start rounded-lg border px-3 py-2 text-sm text-red-700"
        >
          {t('removeAll')}
        </button>
      ) : null}
    </div>
  );
}
