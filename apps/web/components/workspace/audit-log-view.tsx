'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { ErrorMessage, Select } from '../form';
import { useWorkspace } from './workspace-shell';

interface Entry {
  id: string;
  occurredAt: string;
  action: string;
  actorType: 'user' | 'platform_owner' | 'support' | 'system';
  actorName: string | null;
  reason: string | null;
}

/** Areas the owner can filter by: the first part of the action code. */
const AREAS = [
  'support',
  'grade',
  'grade_item',
  'exam',
  'homework',
  'attendance',
  'access',
  'lesson',
  'course',
  'payment',
  'payment_request',
  'cash',
  'student',
  'membership',
  'staff',
  'announcement',
  'data',
] as const;

const DATE = { dateStyle: 'medium', timeStyle: 'medium', timeZone: 'Africa/Cairo' } as const;

/** The workspace audit log, for the owner (REQ-AUDIT-002). */
export function AuditLogView() {
  const t = useTranslations('auditLog');
  const formatter = useFormatter();
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const [area, setArea] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (after?: Entry) => {
      try {
        const query = new URLSearchParams();
        if (area) query.set('area', area);
        if (after) {
          query.set('beforeAt', after.occurredAt);
          query.set('beforeId', after.id);
        }
        const page = await api<{ entries: Entry[]; more: boolean }>(
          `${base}/audit-log?${query.toString()}`,
        );
        setEntries((prev) => (after ? [...prev, ...page.entries] : page.entries));
        setMore(page.more);
      } catch (err) {
        setError(err);
      }
    },
    [base, area],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const areaOf = (action: string) => action.split('.')[0] ?? '';
  const who = (e: Entry) => {
    if (e.actorType === 'system') return t('system');
    const name = e.actorName ?? t('unknown');
    return e.actorType === 'user' ? name : t(`actor.${e.actorType}`, { name });
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted">{t('explain')}</p>
      <Select
        label={t('area')}
        name="area"
        value={area}
        onChange={(event) => setArea(event.target.value)}
        options={[
          { value: '', label: t('allAreas') },
          ...AREAS.map((a) => ({ value: a, label: t(`areas.${a}`) })),
        ]}
      />
      <ErrorMessage error={error} />
      {entries.length === 0 ? <p className="text-muted">{t('none')}</p> : null}
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li
            key={e.id}
            className={`rounded-xl p-3 text-sm shadow-sm ${
              e.actorType === 'support' ? 'bg-amber-50' : 'bg-surface'
            }`}
          >
            <p className="flex flex-wrap justify-between gap-2">
              <span className="font-semibold">
                {t.has(`areas.${areaOf(e.action)}`)
                  ? t(`areas.${areaOf(e.action)}`)
                  : t('otherArea')}
              </span>
              <span className="text-xs text-muted">
                {formatter.dateTime(new Date(e.occurredAt), DATE)}
              </span>
            </p>
            <p>
              {who(e)} · <Ltr>{e.action}</Ltr>
            </p>
            {e.reason ? (
              <p className="text-xs text-muted">{t('reason', { reason: e.reason })}</p>
            ) : null}
          </li>
        ))}
      </ul>
      {more ? (
        <button
          type="button"
          className="self-start rounded-lg border px-3 py-1 text-sm"
          onClick={() => void load(entries.at(-1))}
        >
          {t('older')}
        </button>
      ) : null}
    </div>
  );
}
