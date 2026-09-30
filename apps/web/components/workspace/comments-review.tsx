'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorMessage } from '../form';
import { useWorkspace } from './workspace-shell';

interface ReviewRow {
  id: string;
  authorName: string;
  side: 'student' | 'staff';
  body: string | null;
  createdAt: string;
  homeworkTitle: string;
  studentName: string;
  reports: number;
}

const DATE = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' } as const;

/** The owner's review of every homework comment in the workspace (REQ-MSG-001). */
export function CommentsReviewView() {
  const t = useTranslations('comments');
  const formatter = useFormatter();
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (before?: string) => {
      try {
        const query = before ? `?before=${encodeURIComponent(before)}` : '';
        const page = (await api<{ comments: ReviewRow[] }>(`${base}/homework-comments${query}`))
          .comments;
        setRows((prev) => (before ? [...prev, ...page] : page));
        setMore(page.length === 50);
      } catch (err) {
        setError(err);
      }
    },
    [base],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('reviewTitle')}</h1>
      <p className="text-sm text-muted">{t('reviewExplain')}</p>
      <ErrorMessage error={error} />
      {rows.length === 0 ? <p className="text-muted">{t('none')}</p> : null}
      <ul className="flex flex-col gap-2">
        {rows.map((c) => (
          <li key={c.id} className="rounded-xl bg-surface p-3 text-sm shadow-sm">
            <p className="text-xs text-muted">
              {c.homeworkTitle} · {c.studentName} ·{' '}
              {formatter.dateTime(new Date(c.createdAt), DATE)}
            </p>
            <p className="text-xs">
              {c.authorName} · {c.side === 'staff' ? t('staff') : t('student')}
              {c.reports > 0 ? (
                <span className="ms-2 text-red-700">{t('reportCount', { count: c.reports })}</span>
              ) : null}
            </p>
            {c.body === null ? (
              <p className="italic text-muted">{t('hidden')}</p>
            ) : (
              <p className="whitespace-pre-wrap">{c.body}</p>
            )}
          </li>
        ))}
      </ul>
      {more ? (
        <button
          type="button"
          className="self-start rounded-lg border px-3 py-1 text-sm"
          onClick={() => void load(rows.at(-1)?.createdAt)}
        >
          {t('older')}
        </button>
      ) : null}
    </div>
  );
}
