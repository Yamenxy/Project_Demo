'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import {
  acknowledge,
  AnswerStore,
  clockOffset,
  enqueueAnswer,
  nextSeq,
  remainingMs,
  type Pending,
  type Response,
} from '../../lib/exam-client';
import { ErrorMessage } from '../form';
import { MathText } from '../math-text';
import { useWorkspace } from './workspace-shell';

interface Paper {
  attemptId: string;
  examTitle: string;
  deadlineAt: string;
  serverNow: string;
  submitted: boolean;
  questions: {
    position: number;
    kind: 'mcq' | 'true_false' | 'short';
    body: string;
    choices: { id: string; text: string }[];
    points: number;
  }[];
  answers: Record<string, { response: Response; seq: number }>;
  result: { score: number | null; max: number } | null;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function format(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Taking an exam (REQ-EXAM-004): each answer is queued on the device and sent with a sequence
 * number until the server acknowledges it; every question shows saved or not saved; the timer
 * uses the server deadline corrected for the device clock; time up submits the attempt.
 */
export function ExamTaker({ attemptId }: { attemptId: string }) {
  const t = useTranslations('exam');
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const router = useRouter();
  const [paper, setPaper] = useState<Paper | null>(null);
  const [values, setValues] = useState<Record<number, Response>>({});
  const [pending, setPending] = useState<Pending[]>([]);
  const [left, setLeft] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const store = useRef<AnswerStore | null>(null);
  const offset = useRef(0);
  const sending = useRef(false);

  const load = useCallback(async () => {
    const sentAt = Date.now();
    const data = await api<Paper>(`${base}/my/attempts/${attemptId}`);
    offset.current = clockOffset(data.serverNow, sentAt, Date.now());
    const s = new AnswerStore(attemptId, storage());
    store.current = s;
    const queued = s.queue();
    const saved: Record<number, Response> = {};
    for (const [position, a] of Object.entries(data.answers)) saved[Number(position)] = a.response;
    for (const q of queued) saved[q.position] = q.response;
    setValues(saved);
    setPending(queued);
    setPaper(data);
    setClosed(data.submitted);
  }, [base, attemptId]);

  useEffect(() => {
    load().catch(setError);
  }, [load]);

  const flush = useCallback(async () => {
    const s = store.current;
    if (!s || sending.current) return;
    sending.current = true;
    try {
      for (const item of s.queue()) {
        try {
          const result = await api<{ seq: number }>(
            `${base}/my/attempts/${attemptId}/answers/${String(item.position)}`,
            { method: 'PUT', body: { response: item.response, seq: item.seq } },
          );
          const rest = acknowledge(s.queue(), item.position, result.seq);
          s.saveQueue(rest);
          setPending(rest);
        } catch (err) {
          if (err instanceof ApiError && err.code === 'attempt_closed') {
            setClosed(true);
            return;
          }
          if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
            // Refused for good (not a network problem): drop it and show the error.
            const rest = s.queue().filter((p) => p.position !== item.position);
            s.saveQueue(rest);
            setPending(rest);
            setError(err);
            continue;
          }
          return; // offline or server busy: keep the queue, retry later
        }
      }
    } finally {
      sending.current = false;
    }
  }, [base, attemptId]);

  useEffect(() => {
    const timer = setInterval(() => void flush(), 5000);
    const online = () => void flush();
    window.addEventListener('online', online);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', online);
    };
  }, [flush]);

  const submit = useCallback(async () => {
    await flush();
    try {
      await api(`${base}/my/attempts/${attemptId}/submit`, { method: 'POST' });
    } catch (err) {
      setError(err);
      return;
    }
    setClosed(true);
    router.push(`${base}/exams`);
  }, [base, attemptId, flush, router]);

  useEffect(() => {
    if (!paper || closed) return;
    const tick = () => {
      const ms = remainingMs(paper.deadlineAt, offset.current, Date.now());
      setLeft(ms);
      if (ms === 0) void submit();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [paper, closed, submit]);

  const answer = (position: number, response: Response) => {
    const s = store.current;
    if (!s || closed) return;
    const seq = nextSeq(s.lastSeq(), Date.now());
    s.saveLastSeq(seq);
    const queue = enqueueAnswer(s.queue(), { position, response, seq });
    s.saveQueue(queue);
    setPending(queue);
    setValues((v) => ({ ...v, [position]: response }));
    void flush();
  };

  if (!paper) return <ErrorMessage error={error} />;
  if (closed) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-xl font-semibold">{paper.examTitle}</h1>
        <p role="status" className="rounded-lg bg-green-50 p-3 text-green-800">
          {t('submitted')}
        </p>
        <Link href={`${base}/exams`} className="underline">
          {t('backToExams')}
        </Link>
      </div>
    );
  }

  const unsaved = new Set(pending.map((p) => p.position));
  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 flex items-center justify-between rounded-xl bg-surface p-3 shadow">
        <h1 className="font-semibold">{paper.examTitle}</h1>
        <span className="font-mono text-lg" dir="ltr" role="timer" aria-label={t('timeLeft')}>
          {left === null ? '--:--' : format(left)}
        </span>
      </div>
      <ErrorMessage error={error} />
      {pending.length > 0 ? (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900" role="status">
          {t('unsavedCount', { count: pending.length })}
        </p>
      ) : null}
      <ol className="flex flex-col gap-4">
        {paper.questions.map((q, index) => {
          const value = values[q.position];
          return (
            <li key={q.position} className="rounded-2xl bg-surface p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between text-xs text-muted">
                <span>{t('questionMeta', { number: index + 1, points: q.points })}</span>
                <span>
                  {value === undefined ? '' : unsaved.has(q.position) ? t('unsaved') : t('saved')}
                </span>
              </div>
              <MathText text={q.body} className="font-semibold" />
              <div className="mt-3 flex flex-col gap-2">
                {q.kind === 'mcq'
                  ? q.choices.map((c) => (
                      <label key={c.id} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`q${String(q.position)}`}
                          className="size-4"
                          checked={
                            value !== undefined && 'choiceId' in value && value.choiceId === c.id
                          }
                          onChange={() => answer(q.position, { choiceId: c.id })}
                        />
                        <MathText text={c.text} />
                      </label>
                    ))
                  : null}
                {q.kind === 'true_false'
                  ? [true, false].map((v) => (
                      <label key={String(v)} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`q${String(q.position)}`}
                          className="size-4"
                          checked={value !== undefined && 'value' in value && value.value === v}
                          onChange={() => answer(q.position, { value: v })}
                        />
                        {v ? t('true') : t('false')}
                      </label>
                    ))
                  : null}
                {q.kind === 'short' ? (
                  <input
                    aria-label={t('yourAnswer')}
                    defaultValue={value !== undefined && 'text' in value ? value.text : ''}
                    onBlur={(event) => answer(q.position, { text: event.target.value })}
                    className="rounded-lg border px-3 py-2"
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        onClick={() => window.confirm(t('confirmSubmit')) && void submit()}
        className="rounded-lg bg-brand px-4 py-3 font-semibold text-brand-contrast"
      >
        {t('submit')}
      </button>
    </div>
  );
}

/** The student's exams, with start, continue, and released results. */
export function MyExamsView() {
  const t = useTranslations('exam');
  const formatter = useFormatter();
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const router = useRouter();
  const [items, setItems] = useState<
    {
      id: string;
      title: string;
      opensAt: string;
      closesAt: string;
      timeLimitMinutes: number;
      status: 'upcoming' | 'open' | 'closed';
      attemptsUsed: number;
      maxAttempts: number;
      inProgressAttemptId: string | null;
      canStart: boolean;
      result: { score: number | null; max: number } | null;
    }[]
  >([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ exams: typeof items }>(`${base}/my/exams`)
      .then((data) => setItems(data.exams))
      .catch(setError);
  }, [base]);

  const start = (examId: string) => {
    api<{ attemptId: string }>(`${base}/my/exams/${examId}/attempts`, { method: 'POST' })
      .then(({ attemptId }) => router.push(`${base}/attempts/${attemptId}`))
      .catch(setError);
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('myTitle')}</h1>
      <ErrorMessage error={error} />
      {items.length === 0 ? <p className="text-muted">{t('none')}</p> : null}
      <ul className="flex flex-col gap-2">
        {items.map((e) => (
          <li key={e.id} className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="font-semibold">{e.title}</p>
            <p className="text-sm text-muted">
              {t('window', {
                from: formatter.dateTime(new Date(e.opensAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Africa/Cairo',
                }),
                to: formatter.dateTime(new Date(e.closesAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  timeZone: 'Africa/Cairo',
                }),
                minutes: e.timeLimitMinutes,
              })}
            </p>
            <p className="text-sm text-muted">
              {t('attempts', { used: e.attemptsUsed, max: e.maxAttempts })}
            </p>
            {e.result ? (
              <p className="mt-1 font-semibold">
                {t('result', { score: e.result.score ?? 0, max: e.result.max })}
              </p>
            ) : null}
            {e.canStart ? (
              <button
                type="button"
                onClick={() => start(e.id)}
                className="mt-2 rounded-lg bg-brand px-4 py-2 font-semibold text-brand-contrast"
              >
                {e.inProgressAttemptId ? t('continue') : t('start')}
              </button>
            ) : (
              <p className="mt-2 text-sm text-muted">{t(`status.${e.status}`)}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
