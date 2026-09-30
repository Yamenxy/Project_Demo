'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { ErrorMessage } from '../form';
import { PushPrompt } from '../push-prompt';

interface NotificationItem {
  id: string;
  createdAt: string;
  type: string;
  params: Record<string, string | number | boolean>;
  link: string | null;
  read: boolean;
}

/** ICU messages take strings and numbers. */
function messageValues(params: NotificationItem['params']): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v]),
  );
}

/** Message key for a notification type: `account.password_reset` → `types.account_password_reset`. */
function messageKey(type: string): string {
  return `types.${type.replace(/\./g, '_')}`;
}

export function NotificationsView() {
  const t = useTranslations('notifications');
  const format = useFormatter();
  const router = useRouter();
  const [items, setItems] = useState<NotificationItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api<{ items: NotificationItem[] }>('/notifications')).items);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setError(err);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const markAllRead = async () => {
    try {
      await api('/notifications/read-all', { method: 'POST' });
      await load();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Link href="/account" className="text-sm underline">
          {t('back')}
        </Link>
      </div>
      <PushPrompt />
      <ErrorMessage error={error} />
      {items && items.length === 0 ? <p className="text-muted">{t('empty')}</p> : null}
      {items && items.some((item) => !item.read) ? (
        <button
          type="button"
          onClick={() => void markAllRead()}
          className="self-start rounded-lg border px-3 py-2 text-sm"
        >
          {t('markAllRead')}
        </button>
      ) : null}
      <ul className="flex flex-col gap-3">
        {(items ?? []).map((item) => {
          const key = messageKey(item.type);
          return (
            <li
              key={item.id}
              className={`rounded-xl bg-surface p-4 shadow-sm ${item.read ? 'opacity-70' : 'border-s-4 border-brand'}`}
            >
              <p>{t.has(key) ? t(key, messageValues(item.params)) : t('types.unknown')}</p>
              <p className="mt-1 text-sm text-muted">
                {format.dateTime(new Date(item.createdAt), {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
