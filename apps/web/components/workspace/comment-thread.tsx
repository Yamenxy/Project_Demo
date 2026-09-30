'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { ErrorMessage } from '../form';

interface Comment {
  id: string;
  authorName: string;
  side: 'student' | 'staff';
  mine: boolean;
  body: string | null;
  createdAt: string;
}

const DATE = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' } as const;

/**
 * The comment thread on one homework submission (REQ-MSG-001), shared by the student's and the
 * staff's pages. Any comment by someone else can be reported to the platform owners.
 */
export function CommentThread({ base, submissionId }: { base: string; submissionId: string }) {
  const t = useTranslations('comments');
  const formatter = useFormatter();
  const url = `${base}/homework-submissions/${submissionId}/comments`;
  const [items, setItems] = useState<Comment[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [reporting, setReporting] = useState<string | null>(null);
  const [reported, setReported] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    try {
      setItems((await api<{ comments: Comment[] }>(url)).comments);
    } catch (err) {
      setError(err);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form).get('body');
    if (typeof body !== 'string' || body.trim() === '') return;
    setBusy(true);
    setError(null);
    api(url, { method: 'POST', body: { body } })
      .then(() => {
        form.reset();
        return load();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const report = (commentId: string) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const reason = new FormData(event.currentTarget).get('reason');
    setError(null);
    api(`${base}/homework-comments/${commentId}/report`, {
      method: 'POST',
      body: { reason: typeof reason === 'string' ? reason : '' },
    })
      .then(() => {
        setReporting(null);
        setReported((prev) => new Set(prev).add(commentId));
      })
      .catch(setError);
  };

  return (
    <div className="mt-2 flex flex-col gap-2 border-t pt-2 text-sm">
      <p className="font-semibold">{t('title')}</p>
      <ErrorMessage error={error} />
      {items.length === 0 ? <p className="text-xs text-muted">{t('none')}</p> : null}
      <ul className="flex flex-col gap-2">
        {items.map((c) => (
          <li
            key={c.id}
            className={`rounded-lg p-2 ${c.side === 'staff' ? 'bg-brand/10' : 'bg-gray-100'}`}
          >
            <p className="text-xs text-muted">
              {c.authorName} · {c.side === 'staff' ? t('staff') : t('student')} ·{' '}
              {formatter.dateTime(new Date(c.createdAt), DATE)}
            </p>
            {c.body === null ? (
              <p className="italic text-muted">{t('hidden')}</p>
            ) : (
              <p className="whitespace-pre-wrap">{c.body}</p>
            )}
            {!c.mine && c.body !== null ? (
              reported.has(c.id) ? (
                <p className="text-xs text-muted">{t('reported')}</p>
              ) : reporting === c.id ? (
                <form onSubmit={report(c.id)} className="mt-1 flex flex-wrap gap-2">
                  <input
                    name="reason"
                    required
                    minLength={3}
                    maxLength={500}
                    aria-label={t('reason')}
                    placeholder={t('reason')}
                    className="flex-1 rounded-lg border border-gray-300 px-2 py-1"
                  />
                  <button type="submit" className="rounded-lg border px-2 py-1">
                    {t('sendReport')}
                  </button>
                </form>
              ) : (
                <button
                  type="button"
                  className="text-xs text-muted underline"
                  onClick={() => setReporting(c.id)}
                >
                  {t('report')}
                </button>
              )
            ) : null}
          </li>
        ))}
      </ul>
      <form onSubmit={send} className="flex gap-2">
        <textarea
          name="body"
          rows={2}
          maxLength={2000}
          aria-label={t('write')}
          placeholder={t('write')}
          className="flex-1 rounded-lg border border-gray-300 px-2 py-1"
        />
        <button
          type="submit"
          disabled={busy}
          className="self-end rounded-lg bg-brand px-3 py-1 text-brand-contrast"
        >
          {t('send')}
        </button>
      </form>
    </div>
  );
}
