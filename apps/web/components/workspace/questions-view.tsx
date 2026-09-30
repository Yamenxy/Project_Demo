'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { ErrorMessage, SubmitButton } from '../form';
import { MathText } from '../math-text';
import { useWorkspace } from './workspace-shell';

interface Question {
  id: string;
  version: number;
  kind: 'mcq' | 'true_false' | 'short';
  body: string;
  choices: { id: string; text: string }[];
  answer: { correct?: string; value?: boolean; accepted?: string[]; arabicVariants?: boolean };
  points: number;
}

/** The question bank of a course (REQ-QBANK-001 to -003). */
export function QuestionsView({ courseId }: { courseId: string }) {
  const t = useTranslations('questions');
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const [items, setItems] = useState<Question[]>([]);
  const [kind, setKind] = useState<Question['kind']>('mcq');
  const [body, setBody] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(
        (await api<{ questions: Question[] }>(`${base}/courses/${courseId}/questions`)).questions,
      );
    } catch (err) {
      setError(err);
    }
  }, [base, courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null)?.value ?? '';
    const points = Number(field('points') || '1');
    const payload =
      kind === 'mcq'
        ? {
            kind,
            body,
            points,
            choices: field('choices')
              .split('\n')
              .map((c) => c.trim())
              .filter(Boolean),
            correctIndex: Number(field('correct') || '1') - 1,
          }
        : kind === 'true_false'
          ? { kind, body, points, value: field('value') === 'true' }
          : {
              kind,
              body,
              points,
              accepted: field('accepted')
                .split('\n')
                .map((c) => c.trim())
                .filter(Boolean),
              arabicVariants: (form.elements.namedItem('variants') as HTMLInputElement).checked,
            };
    setBusy(true);
    setError(null);
    api(`${base}/courses/${courseId}/questions`, { method: 'POST', body: payload })
      .then(() => {
        form.reset();
        setBody('');
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
      {items.length === 0 ? <p className="text-muted">{t('empty')}</p> : null}
      <ol className="flex flex-col gap-3">
        {items.map((q, index) => (
          <li key={q.id} className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="mb-1 text-xs text-muted">
              {t('meta', {
                number: index + 1,
                kind: t(`kinds.${q.kind}`),
                points: q.points,
                version: q.version,
              })}
            </p>
            <MathText text={q.body} className="font-semibold" />
            {q.kind === 'mcq' ? (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {q.choices.map((c) => (
                  <li
                    key={c.id}
                    className={c.id === q.answer.correct ? 'font-semibold text-brand' : ''}
                  >
                    <MathText text={c.text} />
                  </li>
                ))}
              </ul>
            ) : null}
            {q.kind === 'true_false' ? (
              <p className="mt-2 text-sm text-brand">{q.answer.value ? t('true') : t('false')}</p>
            ) : null}
            {q.kind === 'short' ? (
              <p className="mt-2 text-sm text-brand">{q.answer.accepted?.join('، ')}</p>
            ) : null}
          </li>
        ))}
      </ol>

      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">{t('newTitle')}</h2>
        <form onSubmit={submit} noValidate className="flex flex-col gap-3 text-sm">
          <label className="flex flex-col gap-1 font-semibold">
            {t('kind')}
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as Question['kind'])}
              className="rounded-lg border px-3 py-2 font-normal"
            >
              <option value="mcq">{t('kinds.mcq')}</option>
              <option value="true_false">{t('kinds.true_false')}</option>
              <option value="short">{t('kinds.short')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 font-semibold">
            {t('body')}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
              required
              className="rounded-lg border px-3 py-2 font-normal"
            />
          </label>
          <p className="text-xs text-muted">
            {t.rich('mathHint', {
              example: (chunks) => (
                <code dir="ltr" className="inline-block">
                  {chunks}
                </code>
              ),
            })}
          </p>
          {body ? (
            <div className="rounded-lg border border-dashed p-3">
              <p className="mb-1 text-xs text-muted">{t('preview')}</p>
              <MathText text={body} />
            </div>
          ) : null}
          {kind === 'mcq' ? (
            <>
              <label className="flex flex-col gap-1 font-semibold">
                {t('choices')}
                <textarea
                  name="choices"
                  rows={4}
                  className="rounded-lg border px-3 py-2 font-normal"
                />
              </label>
              <label className="flex items-center gap-2 font-semibold">
                {t('correct')}
                <input
                  name="correct"
                  type="number"
                  min={1}
                  max={8}
                  defaultValue={1}
                  dir="ltr"
                  className="w-16 rounded-lg border px-2 py-1"
                />
              </label>
            </>
          ) : null}
          {kind === 'true_false' ? (
            <label className="flex items-center gap-2 font-semibold">
              {t('answer')}
              <select name="value" className="rounded-lg border px-2 py-1 font-normal">
                <option value="true">{t('true')}</option>
                <option value="false">{t('false')}</option>
              </select>
            </label>
          ) : null}
          {kind === 'short' ? (
            <>
              <label className="flex flex-col gap-1 font-semibold">
                {t('accepted')}
                <textarea
                  name="accepted"
                  rows={3}
                  className="rounded-lg border px-3 py-2 font-normal"
                />
              </label>
              <label className="flex items-center gap-2">
                <input name="variants" type="checkbox" defaultChecked className="size-4" />
                {t('variants')}
              </label>
            </>
          ) : null}
          <label className="flex items-center gap-2 font-semibold">
            {t('points')}
            <input
              name="points"
              type="number"
              min={0.5}
              step={0.5}
              defaultValue={1}
              dir="ltr"
              className="w-20 rounded-lg border px-2 py-1"
            />
          </label>
          <SubmitButton busy={busy}>{t('add')}</SubmitButton>
        </form>
      </section>
    </div>
  );
}
