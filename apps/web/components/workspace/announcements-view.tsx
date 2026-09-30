'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { ErrorMessage, Field, Select, SubmitButton, TextArea } from '../form';
import { useWorkspace } from './workspace-shell';

interface Announcement {
  id: string;
  className: string | null;
  title: string;
  body: string;
  authorName: string;
  createdAt: string;
  recipients: number;
  delivered: boolean;
}

const DATE = { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Cairo' } as const;

/**
 * Announcements (REQ-NOTIF-001). Staff with `announcements.post` post to a class they work with,
 * or, with the permission for the whole workspace, to every student; students read theirs.
 */
export function AnnouncementsView() {
  const t = useTranslations('announcements');
  const formatter = useFormatter();
  const { workspace, membership } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const isStudent = membership.role === 'student';
  const [items, setItems] = useState<Announcement[]>([]);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [sent, setSent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(
        (
          await api<{ announcements: Announcement[] }>(
            isStudent ? `${base}/my/announcements` : `${base}/announcements`,
          )
        ).announcements,
      );
      if (!isStudent) {
        setClasses(
          (await api<{ classes: { id: string; name: string }[] }>(`${base}/classes`)).classes,
        );
      }
    } catch (err) {
      setError(err);
    }
  }, [base, isStudent]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const text = (name: string) => {
      const value = data.get(name);
      return typeof value === 'string' ? value : '';
    };
    setBusy(true);
    setError(null);
    setSent(null);
    api<{ recipients: number }>(`${base}/announcements`, {
      method: 'POST',
      body: {
        title: text('title'),
        body: text('body'),
        classId: text('audience') === 'all' ? undefined : text('audience'),
      },
    })
      .then((result) => {
        form.reset();
        setSent(result.recipients);
        return load();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const audience = [
    ...(membership.role === 'owner' ? [{ value: 'all', label: t('everyone') }] : []),
    ...classes.map((c) => ({ value: c.id, label: c.name })),
  ];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />
      {!isStudent ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-4 font-semibold">{t('newTitle')}</h2>
          <form onSubmit={post} noValidate className="flex flex-col gap-1 text-sm">
            <Select label={t('audience')} name="audience" options={audience} />
            <Field label={t('announcementTitle')} name="title" required />
            <TextArea label={t('body')} name="body" rows={4} required />
            <SubmitButton busy={busy}>{t('post')}</SubmitButton>
            {sent !== null ? (
              <p role="status" className="text-sm text-muted">
                {t('sending', { count: sent })}
              </p>
            ) : null}
          </form>
        </section>
      ) : null}
      {items.length === 0 ? <p className="text-muted">{t('none')}</p> : null}
      <ul className="flex flex-col gap-3">
        {items.map((a) => (
          <li key={a.id} className="rounded-xl bg-surface p-4 shadow-sm">
            <p className="font-semibold">{a.title}</p>
            <p className="text-xs text-muted">
              {a.className ?? t('everyone')} · {a.authorName} ·{' '}
              {formatter.dateTime(new Date(a.createdAt), DATE)}
              {!isStudent
                ? ` · ${a.delivered ? t('delivered', { count: a.recipients }) : t('inProgress')}`
                : ''}
            </p>
            <p className="mt-2 whitespace-pre-wrap text-sm">{a.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
