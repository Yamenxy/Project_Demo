'use client';

import { toWesternDigits } from '@lms/shared';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import type { Locale } from '../../i18n/routing';
import { api, ApiError } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { ErrorMessage, Field, Select, SubmitButton } from '../form';
import {
  PAYMENT_METHODS,
  PLANS,
  STATUS_STYLE,
  type PaymentView,
  type WorkspaceSummary,
} from './types';

type Detail = WorkspaceSummary & { payments: PaymentView[] };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** One teacher workspace: subscription, payments received, suspension. */
export function WorkspaceDetail({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations('platform');
  const format = useFormatter();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setDetail(await api<Detail>(`/platform/workspaces/${workspaceId}`));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setError(err);
    }
  }, [router, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async (path: string, body: object, form: HTMLFormElement) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/platform/workspaces/${workspaceId}/${path}`, { method: 'POST', body });
      form.reset();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const recordPayment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    void submit(
      'payments',
      {
        amount: Number(toWesternDigits(value('amount'))),
        method: value('method'),
        reference: value('reference') || undefined,
        paidOn: value('paidOn'),
        months: Number(value('months')),
        plan: value('plan'),
      },
      form,
    );
  };

  const changeSuspension = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const note = (form.elements.namedItem('note') as HTMLInputElement | null)?.value ?? '';
    void submit(detail?.suspension === 'admin' ? 'restore' : 'suspend', { note }, form);
  };

  if (!detail) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-10">
        <ErrorMessage error={error} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-10">
      <Link href="/platform" className="text-sm underline">
        {t('back')}
      </Link>
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-semibold">{detail.name}</h1>
          <span className={`rounded-full px-2 py-0.5 text-sm ${STATUS_STYLE[detail.status]}`}>
            {t(`status.${detail.status}`)}
          </span>
        </div>
        <p className="text-muted">{detail.ownerName}</p>
        <p className="mt-2">
          {t(`plan.${detail.plan}`)} ·{' '}
          {t('until', {
            date: format.dateTime(new Date(detail.periodEndsAt), { dateStyle: 'medium' }),
          })}
        </p>
        {detail.suspension ? (
          <p className="mt-2 font-semibold text-red-700">{t(`suspension.${detail.suspension}`)}</p>
        ) : null}
      </section>

      <ErrorMessage error={error} />

      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">{t('recordPayment')}</h2>
        <form onSubmit={recordPayment} noValidate>
          <Field label={t('amount')} name="amount" inputMode="decimal" dir="ltr" required />
          <Select
            label={t('method')}
            name="method"
            options={PAYMENT_METHODS.map((m) => ({ value: m, label: t(`methods.${m}`) }))}
          />
          <Field label={t('reference')} name="reference" dir="ltr" />
          <Field label={t('paidOn')} name="paidOn" type="date" defaultValue={today()} required />
          <Select
            label={t('months')}
            name="months"
            options={[1, 3, 6, 12].map((n) => ({
              value: String(n),
              label: t('monthsCount', { count: n }),
            }))}
          />
          <Select
            label={t('planLabel')}
            name="plan"
            defaultValue={detail.plan}
            options={PLANS.map((plan) => ({ value: plan, label: t(`plan.${plan}`) }))}
          />
          <SubmitButton busy={busy}>{t('savePayment')}</SubmitButton>
        </form>
      </section>

      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-3 font-semibold">{t('payments')}</h2>
        {detail.payments.length === 0 ? <p className="text-muted">{t('noPayments')}</p> : null}
        <ul className="flex flex-col gap-2">
          {detail.payments.map((p) => (
            <li key={p.id} className="flex justify-between gap-3 border-b pb-2 last:border-b-0">
              <span>
                {formatNumber(p.amountPiastres / 100, locale, 'western', {
                  style: 'currency',
                  currency: 'EGP',
                })}{' '}
                · {t(`methods.${p.method}`)} · {t('monthsCount', { count: p.months })}
              </span>
              <span className="text-sm text-muted">
                {format.dateTime(new Date(p.paidOn), { dateStyle: 'medium' })}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-3 font-semibold">
          {detail.suspension === 'admin' ? t('restoreTitle') : t('suspendTitle')}
        </h2>
        <form onSubmit={changeSuspension} noValidate>
          <Field label={t('note')} name="note" required />
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg border px-4 py-3 font-semibold text-red-700 disabled:opacity-60"
          >
            {detail.suspension === 'admin' ? t('restore') : t('suspend')}
          </button>
        </form>
      </section>
    </main>
  );
}
