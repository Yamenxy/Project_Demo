'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '../../i18n/routing';
import { api, ApiError } from '../../lib/api';
import { formatMoney, parseMoney } from '../../lib/format';
import { ErrorMessage, Field, SubmitButton } from '../form';
import { useWorkspace } from './workspace-shell';

export interface PriceItem {
  id: string;
  name: string;
  amountPiastres: number;
  currency: string;
  description: string | null;
  archived: boolean;
}

/** The owner's price list (REQ-PAY-006). */
export function PriceListView() {
  const t = useTranslations('prices');
  const locale = useLocale() as Locale;
  const { workspace } = useWorkspace();
  const url = `/w/${workspace.id}/price-items`;
  const [archived, setArchived] = useState(false);
  const [items, setItems] = useState<PriceItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(
        (await api<{ items: PriceItem[] }>(`${url}${archived ? '?archived=true' : ''}`)).items,
      );
    } catch (err) {
      setError(err);
    }
  }, [url, archived]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value;
    const amount = parseMoney(field('amount'));
    if (amount === null) {
      setError(new ApiError(400, 'invalid_amount'));
      return;
    }
    run(() =>
      api(url, {
        method: 'POST',
        body: {
          name: field('name'),
          amountPiastres: amount,
          ...(field('description') ? { description: field('description') } : {}),
        },
      }).then(() => form.reset()),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <button
          type="button"
          onClick={() => setArchived(!archived)}
          className="rounded-full border px-3 py-1 text-sm"
        >
          {archived ? t('showActive') : t('showArchived')}
        </button>
      </div>
      <p className="text-sm text-muted">{t('explain')}</p>
      <ErrorMessage error={error} />
      {items.length === 0 ? <p className="text-muted">{t('empty')}</p> : null}
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-4 shadow-sm"
          >
            <div>
              <p className="font-semibold">{item.name}</p>
              {item.description ? <p className="text-sm text-muted">{item.description}</p> : null}
            </div>
            <div className="flex items-center gap-3">
              <span className="font-semibold">
                {formatMoney(item.amountPiastres, locale, item.currency)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  run(() =>
                    api(`${url}/${item.id}`, {
                      method: 'POST',
                      body: { archived: !item.archived },
                    }),
                  )
                }
                className="rounded-lg border px-2 py-1 text-xs"
              >
                {item.archived ? t('restore') : t('archive')}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!archived ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-4 font-semibold">{t('addTitle')}</h2>
          <form onSubmit={create} noValidate>
            <Field label={t('name')} name="name" required />
            <Field
              label={t('amount')}
              name="amount"
              inputMode="decimal"
              dir="ltr"
              required
              hint={t('amountHint')}
            />
            <Field label={t('description')} name="description" />
            <SubmitButton busy={busy}>{t('add')}</SubmitButton>
          </form>
        </section>
      ) : null}
    </div>
  );
}
