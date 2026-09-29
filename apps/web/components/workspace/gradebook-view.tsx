'use client';

import { toWesternDigits } from '@lms/shared';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { ErrorMessage, Field, SubmitButton } from '../form';
import { useWorkspace } from './workspace-shell';

interface Gradebook {
  classId: string;
  className: string;
  items: {
    id: string;
    title: string;
    maxScore: number;
    released: boolean;
    classAverage: number | null;
  }[];
  students: {
    membershipId: string;
    name: string;
    enrolled: boolean;
    scores: Record<string, number | null>;
    average: number | null;
  }[];
}

/** Reads "17.5", "١٧٫٥" or empty (absent). Undefined when invalid. */
function parseScore(text: string): number | null | undefined {
  const value = toWesternDigits(text.trim()).replace('٫', '.').replace(',', '.');
  if (value === '') return null;
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(value)) return undefined;
  return Number(value);
}

/** A class's gradebook: one item at a time, one input per student, one save (REQ-GRADE-001). */
export function GradebookView({ classId }: { classId: string }) {
  const t = useTranslations('grades');
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const canRelease = membership.role === 'owner' || permissions.includes('grading.release');
  const [book, setBook] = useState<Gradebook | null>(null);
  const [itemId, setItemId] = useState<string>('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await api<Gradebook>(`${base}/classes/${classId}/gradebook`);
      setBook(next);
      setItemId((current) => current || next.items.at(-1)?.id || '');
    } catch (err) {
      setError(err);
    }
  }, [base, classId]);

  useEffect(() => {
    void load();
  }, [load]);

  const item = book?.items.find((i) => i.id === itemId);

  useEffect(() => {
    if (!book || !itemId) return;
    setDraft(
      Object.fromEntries(
        book.students.map((s) => [s.membershipId, s.scores[itemId]?.toString() ?? '']),
      ),
    );
    setSaved(false);
  }, [book, itemId]);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const createItem = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = (form.elements.namedItem('title') as HTMLInputElement).value;
    const max = parseScore((form.elements.namedItem('max') as HTMLInputElement).value);
    if (!max) {
      setError(new ApiError(400, 'invalid_score'));
      return;
    }
    run(async () => {
      const created = await api<{ id: string }>(`${base}/classes/${classId}/grade-items`, {
        method: 'POST',
        body: { title, maxScore: max },
      });
      form.reset();
      setItemId(created.id);
    });
  };

  const save = () => {
    if (!book || !item) return;
    const scores: { membershipId: string; score: number | null }[] = [];
    for (const s of book.students) {
      const parsed = parseScore(draft[s.membershipId] ?? '');
      if (parsed === undefined || (parsed !== null && parsed > item.maxScore)) {
        setError(new ApiError(400, 'score_out_of_range'));
        return;
      }
      if (parsed !== (s.scores[item.id] ?? null))
        scores.push({ membershipId: s.membershipId, score: parsed });
    }
    if (scores.length === 0) return;
    let reason: string | undefined;
    if (item.released) {
      reason = window.prompt(t('reasonPrompt')) ?? undefined;
      if (!reason || reason.trim().length < 3) return;
    }
    run(async () => {
      await api(`${base}/grade-items/${item.id}/scores`, {
        method: 'POST',
        body: { scores, ...(reason ? { reason } : {}) },
      });
      setSaved(true);
    });
  };

  if (!book) return <ErrorMessage error={error} />;

  return (
    <div className="flex flex-col gap-4">
      <Link href={`${base}/classes/${classId}`} className="text-sm underline">
        {book.className}
      </Link>
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />

      {book.items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('item')}
            value={itemId}
            onChange={(event) => setItemId(event.target.value)}
            className="rounded-lg border px-3 py-2"
          >
            {book.items.map((i) => (
              <option key={i.id} value={i.id}>
                {t('itemOption', { title: i.title, max: i.maxScore })}
              </option>
            ))}
          </select>
          {item ? (
            <span className="text-sm text-muted">
              {item.released ? t('released') : t('notReleased')}
              {item.classAverage !== null
                ? ` · ${t('classAverage', { value: item.classAverage })}`
                : ''}
            </span>
          ) : null}
          {item && canRelease ? (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() =>
                  api(`${base}/grade-items/${item.id}/release`, {
                    method: 'POST',
                    body: { released: !item.released },
                  }),
                )
              }
              className="rounded-lg border px-3 py-1 text-sm"
            >
              {item.released ? t('unrelease') : t('release')}
            </button>
          ) : null}
        </div>
      ) : (
        <p className="text-muted">{t('noItems')}</p>
      )}

      {item ? (
        <ul className="flex flex-col gap-1">
          {book.students.map((s) => (
            <li
              key={s.membershipId}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2 shadow-sm"
            >
              <span className={s.enrolled ? '' : 'text-muted'}>
                {s.name}
                {s.enrolled ? '' : ` (${t('left')})`}
              </span>
              <input
                aria-label={t('scoreFor', { name: s.name })}
                inputMode="decimal"
                dir="ltr"
                value={draft[s.membershipId] ?? ''}
                onChange={(event) => {
                  setSaved(false);
                  setDraft((d) => ({ ...d, [s.membershipId]: event.target.value }));
                }}
                className="w-20 rounded-lg border px-2 py-1 text-center"
              />
            </li>
          ))}
        </ul>
      ) : null}
      {item ? (
        <div className="sticky bottom-0 py-2">
          <button
            type="button"
            disabled={busy}
            onClick={save}
            className="w-full rounded-lg bg-brand px-4 py-3 font-semibold text-brand-contrast"
          >
            {t('save')}
          </button>
          {saved ? (
            <p role="status" className="mt-1 text-center text-sm text-brand">
              {t('saved')}
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">{t('newItem')}</h2>
        <form onSubmit={createItem} noValidate>
          <Field label={t('itemTitle')} name="title" required />
          <Field label={t('maxScore')} name="max" inputMode="decimal" dir="ltr" required />
          <SubmitButton busy={busy}>{t('create')}</SubmitButton>
        </form>
      </section>
    </div>
  );
}

/** A student's released grades, in every class they have been in (REQ-GRADE-003). */
export function MyGradesView() {
  const t = useTranslations('grades');
  const { workspace } = useWorkspace();
  const [data, setData] = useState<{
    classes: {
      classId: string;
      className: string;
      items: { id: string; title: string; maxScore: number; score: number | null }[];
      average: number | null;
    }[];
  } | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<NonNullable<typeof data>>(`/w/${workspace.id}/my/grades`).then(setData).catch(setError);
  }, [workspace.id]);

  if (!data) return <ErrorMessage error={error} />;
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('myTitle')}</h1>
      {data.classes.length === 0 ? <p className="text-muted">{t('none')}</p> : null}
      {data.classes.map((c) => (
        <section key={c.classId} className="rounded-2xl bg-surface p-4 shadow-sm">
          <h2 className="mb-2 font-semibold">
            {c.className}
            {c.average !== null ? ` · ${t('average', { value: c.average })}` : ''}
          </h2>
          <ul className="flex flex-col gap-1 text-sm">
            {c.items.map((i) => (
              <li key={i.id} className="flex justify-between">
                <span>{i.title}</span>
                <span dir="ltr">
                  {i.score === null
                    ? t('absent')
                    : t('scoreOf', { score: i.score, max: i.maxScore })}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
