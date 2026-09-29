'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '../../i18n/routing';
import { api, ApiError } from '../../lib/api';
import { formatMoney, parseMoney } from '../../lib/format';
import { ErrorMessage, SubmitButton } from '../form';
import { cairoToday } from './class-schedule';
import { useWorkspace } from './workspace-shell';

interface Balance {
  userId: string;
  name: string;
  holdingPiastres: number;
  pendingHandoverPiastres: number;
}

interface Handover {
  id: string;
  handedBy: { userId: string; name: string };
  amountPiastres: number;
  note: string | null;
  status: 'pending' | 'confirmed' | 'rejected';
}

interface CollectorDay {
  userId: string;
  name: string;
  collectedPiastres: number;
  payments: number;
}

interface Income {
  byMethod: { method: string; paidPiastres: number; reversedPiastres: number; count: number }[];
  netPiastres: number;
}

function monthStart(today: string): string {
  return `${today.slice(0, 8)}01`;
}

function nextDay(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** Cash held by each collector, handovers, and income (REQ-PAY-003, REQ-PAY-007). */
export function CashView() {
  const t = useTranslations('cash');
  const tp = useTranslations('payments');
  const locale = useLocale() as Locale;
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const isOwner = membership.role === 'owner';
  const finance = isOwner || permissions.includes('finance.view');
  const [balances, setBalances] = useState<Balance[]>([]);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [day, setDay] = useState<CollectorDay[]>([]);
  const [income, setIncome] = useState<Income | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const money = (piastres: number) => formatMoney(piastres, locale);

  const load = useCallback(async () => {
    try {
      const overview = await api<{ balances: Balance[]; handovers: Handover[] }>(`${base}/cash`);
      setBalances(overview.balances);
      setHandovers(overview.handovers);
      if (finance) {
        const today = cairoToday();
        setDay(
          (await api<{ collectors: CollectorDay[] }>(`${base}/reports/cash-day?date=${today}`))
            .collectors,
        );
        setIncome(
          await api<Income>(
            `${base}/reports/income?from=${monthStart(today)}&to=${nextDay(today)}`,
          ),
        );
      }
    } catch (err) {
      setError(err);
    }
  }, [base, finance]);

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

  const handOver = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const amount = parseMoney((form.elements.namedItem('amount') as HTMLInputElement).value);
    if (amount === null || amount === 0) {
      setError(new ApiError(400, 'invalid_amount'));
      return;
    }
    run(() =>
      api(`${base}/cash/handovers`, { method: 'POST', body: { amountPiastres: amount } }).then(() =>
        form.reset(),
      ),
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t('holding')}</h2>
        {balances.length === 0 ? <p className="text-muted">{t('noCash')}</p> : null}
        <ul className="flex flex-col gap-2">
          {balances.map((b) => (
            <li
              key={b.userId}
              className="flex flex-wrap justify-between gap-2 rounded-xl bg-surface p-3 shadow-sm"
            >
              <span className="font-semibold">{b.name}</span>
              <span>
                {money(b.holdingPiastres)}
                {b.pendingHandoverPiastres > 0
                  ? ` · ${t('pendingAmount', { amount: money(b.pendingHandoverPiastres) })}`
                  : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {!isOwner && permissions.includes('payments.record') ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-1 font-semibold">{t('handOverTitle')}</h2>
          <p className="mb-3 text-sm text-muted">{t('handOverExplain')}</p>
          <form onSubmit={handOver} noValidate className="flex gap-2">
            <input
              name="amount"
              inputMode="decimal"
              dir="ltr"
              aria-label={t('amount')}
              placeholder={t('amount')}
              className="min-w-0 flex-1 rounded-lg border px-3 py-2"
            />
            <SubmitButton busy={busy}>{t('handOver')}</SubmitButton>
          </form>
        </section>
      ) : null}

      {handovers.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('handovers')}</h2>
          <ul className="flex flex-col gap-2">
            {handovers.map((h) => (
              <li
                key={h.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-3 text-sm shadow-sm"
              >
                <span>
                  {h.handedBy.name} · {money(h.amountPiastres)}
                </span>
                {isOwner && h.status === 'pending' ? (
                  <span className="flex gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() => api(`${base}/cash/handovers/${h.id}/confirm`, { method: 'POST' }))
                      }
                      className="rounded-lg bg-brand px-3 py-1 text-brand-contrast"
                    >
                      {t('confirm')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() => api(`${base}/cash/handovers/${h.id}/reject`, { method: 'POST' }))
                      }
                      className="rounded-lg border px-3 py-1"
                    >
                      {t('reject')}
                    </button>
                  </span>
                ) : (
                  <span className="text-muted">{t(`status.${h.status}`)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {finance ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('today')}</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {day.map((d) => (
              <li key={d.userId} className="flex justify-between">
                <span>{t('dayLine', { name: d.name, count: d.payments })}</span>
                <span className="font-semibold">{money(d.collectedPiastres)}</span>
              </li>
            ))}
          </ul>
          {income ? (
            <div className="mt-4 rounded-2xl bg-surface p-4 shadow-sm">
              <h2 className="mb-2 font-semibold">{t('month')}</h2>
              <ul className="flex flex-col gap-1 text-sm">
                {income.byMethod.map((m) => (
                  <li key={m.method} className="flex justify-between">
                    <span>{tp(`methods.${m.method}`)}</span>
                    <span>{money(m.paidPiastres - m.reversedPiastres)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex justify-between border-t pt-2 font-semibold">
                <span>{t('net')}</span>
                <span>{money(income.netPiastres)}</span>
              </p>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
