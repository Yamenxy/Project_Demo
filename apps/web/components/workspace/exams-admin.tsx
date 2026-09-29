'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { ErrorMessage, Field, SubmitButton } from '../form';
import { MathText } from '../math-text';
import { useWorkspace } from './workspace-shell';

interface ExamSummary {
  id: string;
  title: string;
  opensAt: string;
  closesAt: string;
  published: boolean;
  resultsReleased: boolean;
  attempts: number;
}

/** "2026-10-01T10:00" in Cairo, from a datetime-local input, to an ISO instant. */
function cairoLocalToIso(local: string): string {
  // Cairo is UTC+2 or UTC+3; ask the browser for the offset at that moment in Cairo.
  const guess = new Date(`${local}:00Z`);
  const cairo = new Date(guess.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (cairo.getTime() - utc.getTime())).toISOString();
}

/** A course's exams: list and create (REQ-EXAM-001). */
export function CourseExamsView({ courseId }: { courseId: string }) {
  const t = useTranslations('examAdmin');
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const [exams, setExams] = useState<ExamSummary[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string; courseId: string | null }[]>(
    [],
  );
  const [questions, setQuestions] = useState<{ id: string; body: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setExams((await api<{ exams: ExamSummary[] }>(`${base}/courses/${courseId}/exams`)).exams);
      setClasses((await api<{ classes: typeof classes }>(`${base}/classes`)).classes);
      setQuestions(
        (await api<{ questions: typeof questions }>(`${base}/courses/${courseId}/questions`))
          .questions,
      );
    } catch (err) {
      setError(err);
    }
  }, [base, courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    };
    setBusy(true);
    setError(null);
    api(`${base}/courses/${courseId}/exams`, {
      method: 'POST',
      body: {
        title: text('title'),
        timeLimitMinutes: Number(text('limit')),
        opensAt: cairoLocalToIso(text('opens')),
        closesAt: cairoLocalToIso(text('closes')),
        maxAttempts: Number(text('attempts') || '1'),
        scoreRule: text('rule') || 'highest',
        shuffleQuestions: data.get('shuffleQuestions') === 'on',
        shuffleChoices: data.get('shuffleChoices') === 'on',
        passPercent: text('pass') ? Number(text('pass')) : null,
        classIds: data.getAll('classIds').map(String),
        questionIds: data.getAll('questionIds').map(String),
      },
    })
      .then(() => {
        form.reset();
        return load();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-4">
      <Link href={`${base}/courses/${courseId}`} className="text-sm underline">
        {t('backToCourse')}
      </Link>
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />
      <ul className="flex flex-col gap-2">
        {exams.map((e) => (
          <li key={e.id}>
            <Link
              href={`${base}/exams/${e.id}`}
              className="block rounded-xl bg-surface p-3 shadow-sm hover:ring-2 hover:ring-brand"
            >
              <p className="font-semibold">{e.title}</p>
              <p className="text-xs text-muted">
                {e.published ? t('published') : t('draft')} ·{' '}
                {t('attemptCount', { count: e.attempts })}
                {e.resultsReleased ? ` · ${t('released')}` : ''}
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">{t('newTitle')}</h2>
        <form onSubmit={create} noValidate className="flex flex-col gap-1 text-sm">
          <Field label={t('examTitle')} name="title" required />
          <Field label={t('opens')} name="opens" type="datetime-local" dir="ltr" required />
          <Field label={t('closes')} name="closes" type="datetime-local" dir="ltr" required />
          <Field
            label={t('limit')}
            name="limit"
            type="number"
            min={1}
            defaultValue={30}
            dir="ltr"
            required
          />
          <Field
            label={t('attempts')}
            name="attempts"
            type="number"
            min={1}
            max={10}
            defaultValue={1}
            dir="ltr"
          />
          <label className="mb-3 flex items-center gap-2">
            {t('rule')}
            <select name="rule" className="rounded-lg border px-2 py-1">
              <option value="highest">{t('highest')}</option>
              <option value="latest">{t('latest')}</option>
            </select>
          </label>
          <Field label={t('pass')} name="pass" type="number" min={1} max={100} dir="ltr" />
          <label className="flex items-center gap-2">
            <input type="checkbox" name="shuffleQuestions" className="size-4" />{' '}
            {t('shuffleQuestions')}
          </label>
          <label className="mb-3 flex items-center gap-2">
            <input type="checkbox" name="shuffleChoices" className="size-4" /> {t('shuffleChoices')}
          </label>
          <fieldset className="mb-3">
            <legend className="mb-1 font-semibold">{t('classes')}</legend>
            {classes.map((c) => (
              <label key={c.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="classIds"
                  value={c.id}
                  defaultChecked={c.courseId === courseId}
                  className="size-4"
                />
                {c.name}
              </label>
            ))}
          </fieldset>
          <fieldset className="mb-3">
            <legend className="mb-1 font-semibold">{t('questions')}</legend>
            {questions.map((q) => (
              <label key={q.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="questionIds"
                  value={q.id}
                  defaultChecked
                  className="mt-1 size-4"
                />
                <MathText text={q.body} />
              </label>
            ))}
          </fieldset>
          <SubmitButton busy={busy}>{t('create')}</SubmitButton>
        </form>
      </section>
    </div>
  );
}

/** One exam: publish, accommodations, results and release (REQ-EXAM-001, REQ-GRADE-001). */
export function ExamAdminView({ examId }: { examId: string }) {
  const t = useTranslations('examAdmin');
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const canRelease = membership.role === 'owner' || permissions.includes('grading.release');
  const [exam, setExam] = useState<
    | (ExamSummary & {
        courseId: string;
        items: { position: number; body: string; points: number }[];
      })
    | null
  >(null);
  const [results, setResults] = useState<{
    max: number;
    rows: {
      membershipId: string;
      name: string;
      attempts: { number: number; score: number | null; submitted: boolean }[];
      counted: number | null;
      passed: boolean | null;
    }[];
  } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setExam(await api(`${base}/exams/${examId}`));
      setResults(await api(`${base}/exams/${examId}/results`));
    } catch (err) {
      setError(err);
    }
  }, [base, examId]);

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

  if (!exam) return <ErrorMessage error={error} />;
  return (
    <div className="flex flex-col gap-4">
      <Link href={`${base}/courses/${exam.courseId}/exams`} className="text-sm underline">
        {t('title')}
      </Link>
      <h1 className="text-xl font-semibold">{exam.title}</h1>
      <ErrorMessage error={error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            run(() =>
              api(`${base}/exams/${examId}/publish`, {
                method: 'POST',
                body: { published: !exam.published },
              }),
            )
          }
          className="rounded-lg border px-3 py-2 text-sm"
        >
          {exam.published ? t('unpublish') : t('publish')}
        </button>
        {canRelease && !exam.resultsReleased ? (
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              window.confirm(t('confirmRelease')) &&
              run(() => api(`${base}/exams/${examId}/release`, { method: 'POST' }))
            }
            className="rounded-lg bg-brand px-3 py-2 text-sm text-brand-contrast"
          >
            {t('release')}
          </button>
        ) : null}
        {exam.resultsReleased ? <span className="text-sm text-muted">{t('released')}</span> : null}
      </div>
      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">{t('results', { max: results?.max ?? 0 })}</h2>
        {results?.rows.length ? null : <p className="text-sm text-muted">{t('noAttempts')}</p>}
        <ul className="flex flex-col gap-2 text-sm">
          {results?.rows.map((r) => (
            <li key={r.membershipId} className="flex flex-wrap items-center justify-between gap-2">
              <span>{r.name}</span>
              <span>
                {r.counted === null
                  ? t('inProgress')
                  : t('score', { score: r.counted, max: results.max })}
                {r.passed === null ? '' : ` · ${r.passed ? t('passed') : t('failed')}`}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const minutes = window.prompt(t('extraPrompt', { name: r.name }));
                  if (minutes === null) return;
                  run(() =>
                    api(`${base}/exams/${examId}/accommodations/${r.membershipId}`, {
                      method: 'PUT',
                      body: { extraMinutes: minutes.trim() ? Number(minutes) : null },
                    }),
                  );
                }}
                className="rounded-lg border px-2 py-0.5 text-xs"
              >
                {t('extraTime')}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-2xl bg-surface p-4 shadow-sm">
        <h2 className="mb-2 font-semibold">{t('questions')}</h2>
        <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm">
          {exam.items.map((i) => (
            <li key={i.position}>
              <MathText text={i.body} /> {t('pointsInBrackets', { points: i.points })}
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
