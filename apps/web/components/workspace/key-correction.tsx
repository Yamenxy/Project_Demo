'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '../../lib/api';
import { ErrorMessage } from '../form';
import { MathText } from '../math-text';

export interface ExamItem {
  position: number;
  kind: 'mcq' | 'true_false' | 'short';
  body: string;
  choices: { id: string; text: string }[];
  answer: { correct?: string; value?: boolean; accepted?: string[]; arabicVariants?: boolean };
  points: number;
}

interface Preview {
  attemptsChanged: number;
  studentsChanged: number;
  passFailChanged: number;
}

/**
 * Correcting an answer key after students started (REQ-EXAM-003): pick the new key, see how many
 * scores and pass/fail outcomes change, then confirm.
 */
export function KeyCorrection({
  base,
  examId,
  item,
  onDone,
}: {
  base: string;
  examId: string;
  item: ExamItem;
  onDone: () => void;
}) {
  const t = useTranslations('examAdmin');
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState(item.answer.correct ?? '');
  const [value, setValue] = useState(item.answer.value ?? true);
  const [accepted, setAccepted] = useState((item.answer.accepted ?? []).join('\n'));
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const key = () =>
    item.kind === 'mcq'
      ? { correctChoiceId: choice }
      : item.kind === 'true_false'
        ? { value }
        : {
            accepted: accepted
              .split('\n')
              .map((a) => a.trim())
              .filter(Boolean),
            arabicVariants: item.answer.arabicVariants ?? true,
          };
  const url = `${base}/exams/${examId}/items/${String(item.position)}`;

  const run = (path: string, then: (result: Preview) => void) => {
    setBusy(true);
    setError(null);
    api<Preview>(`${url}/${path}`, { method: 'POST', body: { key: key() } })
      .then(then)
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <li className="rounded-lg border p-3">
      <MathText text={item.body} /> {t('pointsInBrackets', { points: item.points })}
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ms-2 rounded-lg border px-2 py-0.5 text-xs"
        >
          {t('correctKey')}
        </button>
      ) : (
        <div className="mt-2 flex flex-col gap-2 text-sm">
          <ErrorMessage error={error} />
          {item.kind === 'mcq'
            ? item.choices.map((c) => (
                <label key={c.id} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name={`key-${String(item.position)}`}
                    checked={choice === c.id}
                    onChange={() => {
                      setChoice(c.id);
                      setPreview(null);
                    }}
                    className="size-4"
                  />
                  <MathText text={c.text} />
                </label>
              ))
            : null}
          {item.kind === 'true_false' ? (
            <select
              value={String(value)}
              onChange={(event) => {
                setValue(event.target.value === 'true');
                setPreview(null);
              }}
              className="self-start rounded-lg border px-2 py-1"
            >
              <option value="true">{t('true')}</option>
              <option value="false">{t('false')}</option>
            </select>
          ) : null}
          {item.kind === 'short' ? (
            <textarea
              value={accepted}
              onChange={(event) => {
                setAccepted(event.target.value);
                setPreview(null);
              }}
              rows={3}
              className="rounded-lg border px-2 py-1"
            />
          ) : null}
          {preview ? (
            <p role="status" className="rounded bg-amber-50 p-2 text-amber-900">
              {t('previewLine', {
                attempts: preview.attemptsChanged,
                students: preview.studentsChanged,
                passFail: preview.passFailChanged,
              })}
            </p>
          ) : null}
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => run('key-preview', setPreview)}
              className="rounded-lg border px-3 py-1"
            >
              {t('previewKey')}
            </button>
            {preview ? (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run('key', () => {
                    setOpen(false);
                    setPreview(null);
                    onDone();
                  })
                }
                className="rounded-lg bg-brand px-3 py-1 text-brand-contrast"
              >
                {t('applyKey')}
              </button>
            ) : null}
          </div>
        </div>
      )}
    </li>
  );
}
