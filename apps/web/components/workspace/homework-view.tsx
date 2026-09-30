'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { ErrorMessage, Field, Select, SubmitButton, TextArea } from '../form';
import { PushPrompt } from '../push-prompt';
import { CommentThread } from './comment-thread';
import { cairoLocalToIso } from './exams-admin';
import { FileList } from './file-list';
import { useWorkspace } from './workspace-shell';

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const DATE = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' } as const;

interface HomeworkSummary {
  id: string;
  title: string;
  dueAt: string;
  published: boolean;
  released: boolean;
  submissions: number;
}

interface Submission {
  id: string;
  name: string;
  number: number;
  text: string | null;
  submittedAt: string;
  late: boolean;
  score: number | null;
  feedback: string | null;
}

/** A course's homework: create, publish, grade and release (REQ-HW-001). */
export function CourseHomeworkView({ courseId }: { courseId: string }) {
  const t = useTranslations('homeworkAdmin');
  const formatter = useFormatter();
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const canRelease = membership.role === 'owner' || permissions.includes('grading.release');
  const [items, setItems] = useState<HomeworkSummary[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string; courseId: string | null }[]>(
    [],
  );
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(
        (await api<{ homework: HomeworkSummary[] }>(`${base}/courses/${courseId}/homework`))
          .homework,
      );
      setClasses((await api<{ classes: typeof classes }>(`${base}/classes`)).classes);
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
    api(`${base}/courses/${courseId}/homework`, {
      method: 'POST',
      body: {
        title: text('title'),
        instructions: text('instructions') || undefined,
        dueAt: cairoLocalToIso(text('due')),
        maxScore: Number(text('max')),
        latePolicy: text('latePolicy') || 'accept_flagged',
        allowResubmission: data.get('allowResubmission') === 'on',
        classIds: data.getAll('classIds').map(String),
      },
    })
      .then(() => {
        form.reset();
        return load();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const act = (path: string, body?: object) => {
    setError(null);
    api(`${base}/homework/${path}`, { method: 'POST', ...(body ? { body } : {}) })
      .then(() => load())
      .catch(setError);
  };

  return (
    <div className="flex flex-col gap-4">
      <Link href={`${base}/courses/${courseId}`} className="text-sm underline">
        {t('backToCourse')}
      </Link>
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />
      <ul className="flex flex-col gap-2">
        {items.map((h) => (
          <li key={h.id} className="rounded-xl bg-surface p-3 shadow-sm">
            <p className="font-semibold">{h.title}</p>
            <p className="text-xs text-muted">
              {t('due', { at: formatter.dateTime(new Date(h.dueAt), DATE) })} ·{' '}
              {h.published ? t('published') : t('draft')} ·{' '}
              {t('submissionCount', { count: h.submissions })}
              {h.released ? ` · ${t('released')}` : ''}
            </p>
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <button
                type="button"
                className="rounded-lg border px-3 py-1"
                onClick={() => act(`${h.id}/publish`, { published: !h.published })}
              >
                {h.published ? t('unpublish') : t('publish')}
              </button>
              <button
                type="button"
                className="rounded-lg border px-3 py-1"
                onClick={() => setOpen(open === h.id ? null : h.id)}
              >
                {t('submissions')}
              </button>
              {canRelease ? (
                <button
                  type="button"
                  className="rounded-lg border px-3 py-1"
                  onClick={() => act(`${h.id}/release`)}
                >
                  {h.released ? t('releaseAgain') : t('release')}
                </button>
              ) : null}
            </div>
            {open === h.id ? <Submissions homeworkId={h.id} /> : null}
          </li>
        ))}
      </ul>
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">{t('newTitle')}</h2>
        <form onSubmit={create} noValidate className="flex flex-col gap-1 text-sm">
          <Field label={t('homeworkTitle')} name="title" required />
          <TextArea label={t('instructions')} name="instructions" rows={3} />
          <Field label={t('dueAt')} name="due" type="datetime-local" dir="ltr" required />
          <Field
            label={t('max')}
            name="max"
            type="number"
            min={1}
            step="0.01"
            defaultValue={10}
            dir="ltr"
            required
          />
          <Select
            label={t('latePolicy')}
            name="latePolicy"
            options={[
              { value: 'accept_flagged', label: t('acceptFlagged') },
              { value: 'reject', label: t('reject') },
            ]}
          />
          <label className="mb-3 flex items-center gap-2">
            <input type="checkbox" name="allowResubmission" className="size-4" />{' '}
            {t('allowResubmission')}
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
          <SubmitButton busy={busy}>{t('create')}</SubmitButton>
        </form>
      </section>
    </div>
  );
}

/** Submissions of one homework, with a grade form for each. */
function Submissions({ homeworkId }: { homeworkId: string }) {
  const t = useTranslations('homeworkAdmin');
  const formatter = useFormatter();
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const [rows, setRows] = useState<Submission[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setRows(
        (await api<{ submissions: Submission[] }>(`${base}/homework/${homeworkId}/submissions`))
          .submissions,
      );
    } catch (err) {
      setError(err);
    }
  }, [base, homeworkId]);

  useEffect(() => {
    void load();
  }, [load]);

  const grade = (submissionId: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const feedback = data.get('feedback');
    setError(null);
    api(`${base}/homework-submissions/${submissionId}/grade`, {
      method: 'POST',
      body: {
        score: Number(data.get('score')),
        feedback: typeof feedback === 'string' && feedback ? feedback : undefined,
      },
    })
      .then(() => load())
      .catch(setError);
  };

  if (!rows) return <ErrorMessage error={error} />;
  return (
    <div className="mt-3 flex flex-col gap-3 border-t pt-3">
      <ErrorMessage error={error} />
      {rows.length === 0 ? <p className="text-sm text-muted">{t('noSubmissions')}</p> : null}
      {rows.map((s) => (
        <div key={s.id} className="flex flex-col gap-1 text-sm">
          <p className="font-semibold">
            {s.name} · {t('attempt', { number: s.number })}
            {s.late ? <span className="ms-2 text-red-700">{t('late')}</span> : null}
          </p>
          <p className="text-xs text-muted">{formatter.dateTime(new Date(s.submittedAt), DATE)}</p>
          {s.text ? <p className="whitespace-pre-wrap">{s.text}</p> : null}
          <FileList
            base={base}
            owner="homework-submissions"
            ownerId={s.id}
            canUpload={false}
            accept={ACCEPT}
          />
          <CommentThread base={base} submissionId={s.id} />
          <form onSubmit={grade(s.id)} className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col">
              {t('score')}
              <input
                name="score"
                type="number"
                min={0}
                step="0.01"
                defaultValue={s.score ?? ''}
                dir="ltr"
                className="w-24 rounded-lg border px-2 py-1"
                required
              />
            </label>
            <label className="flex flex-1 flex-col">
              {t('feedback')}
              <input
                name="feedback"
                defaultValue={s.feedback ?? ''}
                className="rounded-lg border px-2 py-1"
              />
            </label>
            <button type="submit" className="rounded-lg bg-brand px-3 py-1 text-brand-contrast">
              {t('saveGrade')}
            </button>
          </form>
        </div>
      ))}
    </div>
  );
}

interface MyHomework {
  id: string;
  title: string;
  instructions: string | null;
  dueAt: string;
  latePolicy: 'reject' | 'accept_flagged';
  maxScore: number;
  canSubmit: boolean;
  submissions: {
    id: string;
    number: number;
    text: string | null;
    submittedAt: string;
    late: boolean;
    score: number | null;
    feedback: string | null;
  }[];
}

/** The student's homework: submit text, attach files, and see released grades (REQ-HW-001). */
export function MyHomeworkView() {
  const t = useTranslations('homework');
  const formatter = useFormatter();
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const [items, setItems] = useState<MyHomework[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ homework: MyHomework[] }>(`${base}/my/homework`)).homework);
    } catch (err) {
      setError(err);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (homeworkId: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = new FormData(event.currentTarget).get('text');
    setError(null);
    api(`${base}/my/homework/${homeworkId}/submissions`, {
      method: 'POST',
      body: { text: typeof text === 'string' && text ? text : undefined },
    })
      .then(() => {
        setSubmitted(true);
        return load();
      })
      .catch(setError);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />
      {submitted ? <PushPrompt /> : null}
      {items.length === 0 ? <p className="text-muted">{t('none')}</p> : null}
      <ul className="flex flex-col gap-3">
        {items.map((h) => (
          <li key={h.id} className="flex flex-col gap-2 rounded-xl bg-surface p-4 shadow-sm">
            <p className="font-semibold">{h.title}</p>
            <p className="text-sm text-muted">
              {t('due', { at: formatter.dateTime(new Date(h.dueAt), DATE) })}
              {h.latePolicy === 'reject' ? ` · ${t('noLate')}` : ''}
            </p>
            {h.instructions ? (
              <p className="whitespace-pre-wrap text-sm">{h.instructions}</p>
            ) : null}
            {h.submissions.map((s) => (
              <div key={s.id} className="rounded-lg border p-2 text-sm">
                <p className="text-xs text-muted">
                  {t('submitted', {
                    number: s.number,
                    at: formatter.dateTime(new Date(s.submittedAt), DATE),
                  })}
                  {s.late ? ` · ${t('late')}` : ''}
                </p>
                {s.text ? <p className="whitespace-pre-wrap">{s.text}</p> : null}
                <FileList
                  base={base}
                  owner="homework-submissions"
                  ownerId={s.id}
                  canUpload={s.score === null}
                  accept={ACCEPT}
                />
                <CommentThread base={base} submissionId={s.id} />
                {s.score !== null ? (
                  <p className="mt-1 font-semibold">
                    {t('score', { score: s.score, max: h.maxScore })}
                  </p>
                ) : null}
                {s.feedback ? (
                  <p className="text-sm">{t('feedback', { text: s.feedback })}</p>
                ) : null}
              </div>
            ))}
            {h.canSubmit ? (
              <form onSubmit={submit(h.id)} className="flex flex-col gap-2 text-sm">
                <textarea
                  name="text"
                  rows={3}
                  aria-label={t('answer')}
                  placeholder={t('answer')}
                  className="rounded-lg border px-2 py-1"
                />
                <p className="text-xs text-muted">{t('filesAfter')}</p>
                <button
                  type="submit"
                  className="self-start rounded-lg bg-brand px-3 py-1 text-brand-contrast"
                >
                  {h.submissions.length > 0 ? t('resubmit') : t('submit')}
                </button>
              </form>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
