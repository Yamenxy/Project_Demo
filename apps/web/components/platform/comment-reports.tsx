'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ErrorMessage } from '../form';

interface Report {
  commentId: string;
  workspaceName: string;
  body: string;
  authorName: string;
  side: 'student' | 'staff';
  commentedAt: string;
  reports: { reason: string; reporterName: string; reportedAt: string }[];
}

const DATE = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' } as const;

/** Reported homework comments, for the platform owners to dismiss or hide (REQ-MSG-001). */
export function CommentReports() {
  const t = useTranslations('platform.reports');
  const formatter = useFormatter();
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setReports((await api<{ reports: Report[] }>('/platform/comment-reports')).reports);
    } catch (err) {
      setError(err);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const resolve = (commentId: string, resolution: 'dismissed' | 'hidden') => {
    setError(null);
    api(`/platform/comment-reports/${commentId}/resolve`, {
      method: 'POST',
      body: { resolution },
    })
      .then(() => load())
      .catch(setError);
  };

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">{t('title')}</h2>
      <ErrorMessage error={error} />
      {reports.length === 0 ? <p className="text-muted">{t('none')}</p> : null}
      <ul className="flex flex-col gap-3">
        {reports.map((r) => (
          <li key={r.commentId} className="rounded-2xl bg-surface p-4 text-sm shadow-sm">
            <p className="text-xs text-muted">
              {r.workspaceName} · {r.authorName} · {r.side === 'staff' ? t('staff') : t('student')}{' '}
              · {formatter.dateTime(new Date(r.commentedAt), DATE)}
            </p>
            <p className="my-2 whitespace-pre-wrap">{r.body}</p>
            <ul className="mb-2 list-disc ps-5 text-xs">
              {r.reports.map((x) => (
                <li key={`${x.reporterName}-${x.reportedAt}`}>
                  {t('reportedBy', { name: x.reporterName, reason: x.reason })}
                </li>
              ))}
            </ul>
            <div className="flex gap-2">
              <button
                type="button"
                className="rounded-lg border px-3 py-1"
                onClick={() => resolve(r.commentId, 'dismissed')}
              >
                {t('dismiss')}
              </button>
              <button
                type="button"
                className="rounded-lg bg-red-700 px-3 py-1 text-white"
                onClick={() => resolve(r.commentId, 'hidden')}
              >
                {t('hide')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
