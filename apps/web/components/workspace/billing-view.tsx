'use client';

import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { Locale } from '../../i18n/routing';
import { api } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { ErrorMessage } from '../form';
import {
  STATUS_STYLE,
  type PaymentMethod,
  type Plan,
  type SubscriptionStatus,
} from '../platform/types';
import { useWorkspace } from './workspace-shell';

interface Billing {
  plan: Plan;
  periodEndsAt: string;
  status: SubscriptionStatus;
  payments: { amountPiastres: number; method: PaymentMethod; paidOn: string; months: number }[];
}

/** The teacher's subscription (REQ-SUB-001); renewing is done with the platform owners. */
export function BillingView() {
  const t = useTranslations('platform');
  const tw = useTranslations('workspace');
  const format = useFormatter();
  const locale = useLocale() as Locale;
  const { workspace } = useWorkspace();
  const [billing, setBilling] = useState<Billing | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Billing>(`/w/${workspace.id}/billing`).then(setBilling, setError);
  }, [workspace.id]);

  if (!billing) return <ErrorMessage error={error} />;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-xl font-semibold">{tw('billingTitle')}</h1>
          <span className={`rounded-full px-2 py-0.5 text-sm ${STATUS_STYLE[billing.status]}`}>
            {t(`status.${billing.status}`)}
          </span>
        </div>
        <p className="mt-2">
          {t(`plan.${billing.plan}`)} ·{' '}
          {t('until', {
            date: format.dateTime(new Date(billing.periodEndsAt), { dateStyle: 'medium' }),
          })}
        </p>
        <p className="mt-2 text-sm text-muted">{tw('billingHowToRenew')}</p>
      </section>
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-3 font-semibold">{t('payments')}</h2>
        {billing.payments.length === 0 ? <p className="text-muted">{t('noPayments')}</p> : null}
        <ul className="flex flex-col gap-2">
          {billing.payments.map((p) => (
            <li key={`${p.paidOn}-${p.amountPiastres}`} className="flex justify-between gap-3">
              <span>
                {formatNumber(p.amountPiastres / 100, locale, 'western', {
                  style: 'currency',
                  currency: 'EGP',
                })}{' '}
                · {t(`methods.${p.method}`)}
              </span>
              <span className="text-sm text-muted">
                {format.dateTime(new Date(p.paidOn), { dateStyle: 'medium' })}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
