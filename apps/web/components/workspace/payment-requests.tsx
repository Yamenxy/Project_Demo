'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '../../i18n/routing';
import { api, ApiError } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { formatMoney, parseMoney } from '../../lib/format';
import { ErrorMessage, SubmitButton } from '../form';
import { FileList } from './file-list';

export interface PaymentRequest {
  id: string;
  membershipId: string;
  studentName: string;
  amountPiastres: number;
  currency: string;
  method: 'transfer' | 'wallet' | 'other';
  reference: string;
  note: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  resubmitsId: string | null;
  rejectReason: string | null;
  duplicateReference: boolean;
  createdAt: string;
}

const METHODS = ['wallet', 'transfer', 'other'] as const;

/** The student's payment requests: send, cancel, resend after a rejection (REQ-PAY-010). */
export function MyPaymentRequests({ base, onChange }: { base: string; onChange?: () => void }) {
  const t = useTranslations('paymentRequests');
  const tp = useTranslations('payments');
  const locale = useLocale() as Locale;
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [resubmit, setResubmit] = useState<PaymentRequest | null>(null);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRequests(
        (await api<{ requests: PaymentRequest[] }>(`${base}/my/payment-requests`)).requests,
      );
    } catch (err) {
      setError(err);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const field = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement).value;
    const amount = parseMoney(field('amount'));
    if (amount === null || amount === 0) {
      setError(new ApiError(400, 'invalid_amount'));
      return;
    }
    setBusy(true);
    setError(null);
    api(`${base}/my/payment-requests`, {
      method: 'POST',
      body: {
        amountPiastres: amount,
        method: field('method'),
        reference: field('reference'),
        ...(field('note').trim() ? { note: field('note').trim() } : {}),
        ...(resubmit ? { resubmitsId: resubmit.id } : {}),
      },
    })
      .then(async () => {
        form.reset();
        setResubmit(null);
        setSent(true);
        await load();
        onChange?.();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const cancel = (id: string) => {
    setBusy(true);
    api(`${base}/my/payment-requests/${id}/cancel`, { method: 'POST' })
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-1 font-semibold">{resubmit ? t('resubmitTitle') : t('title')}</h2>
        <p className="mb-4 text-sm text-muted">{t('explain')}</p>
        <ErrorMessage error={error} />
        {sent ? (
          <p role="status" className="mb-3 rounded-lg bg-green-50 p-3 text-sm text-green-800">
            {t('sent')}
          </p>
        ) : null}
        <form
          key={resubmit?.id ?? 'new'}
          onSubmit={submit}
          noValidate
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t('amount')}
            <input
              name="amount"
              inputMode="decimal"
              dir="ltr"
              required
              defaultValue={resubmit ? String(resubmit.amountPiastres / 100) : ''}
              className="rounded-lg border px-3 py-2 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {tp('method')}
            <select
              name="method"
              defaultValue={resubmit?.method ?? 'wallet'}
              className="rounded-lg border px-3 py-2 font-normal"
            >
              {METHODS.map((m) => (
                <option key={m} value={m}>
                  {tp(`methods.${m}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {t('reference')}
            <input
              name="reference"
              dir="ltr"
              required
              defaultValue={resubmit?.reference ?? ''}
              className="rounded-lg border px-3 py-2 font-normal"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            {tp('note')}
            <input name="note" className="rounded-lg border px-3 py-2 font-normal" />
          </label>
          <SubmitButton busy={busy}>{t('send')}</SubmitButton>
        </form>
      </div>

      {requests.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {requests.map((r) => (
            <li key={r.id} className="rounded-xl bg-surface p-3 text-sm shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">
                  {formatMoney(r.amountPiastres, locale, r.currency)}
                </span>
                <span>{t(`status.${r.status}`)}</span>
              </div>
              <p className="text-muted">
                {tp(`methods.${r.method}`)} · <Ltr>{r.reference}</Ltr>
              </p>
              {r.rejectReason ? <p className="text-red-700">{r.rejectReason}</p> : null}
              <div className="mt-2">
                <FileList
                  base={base}
                  owner="payment-requests"
                  ownerId={r.id}
                  canUpload={r.status === 'pending'}
                  accept="image/png,image/jpeg,image/webp"
                />
              </div>
              {r.status === 'pending' ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => cancel(r.id)}
                  className="mt-2 rounded-lg border px-3 py-1"
                >
                  {t('cancel')}
                </button>
              ) : null}
              {r.status === 'rejected' && !requests.some((o) => o.resubmitsId === r.id) ? (
                <button
                  type="button"
                  onClick={() => {
                    setSent(false);
                    setResubmit(r);
                  }}
                  className="mt-2 rounded-lg border px-3 py-1"
                >
                  {t('resubmit')}
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** Staff with `payments.confirm` review pending requests (REQ-PAY-003, REQ-PAY-008). */
export function PendingRequests({ base, onDecided }: { base: string; onDecided: () => void }) {
  const t = useTranslations('paymentRequests');
  const tp = useTranslations('payments');
  const locale = useLocale() as Locale;
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRequests(
        (await api<{ requests: PaymentRequest[] }>(`${base}/payment-requests?status=pending`))
          .requests,
      );
    } catch (err) {
      setError(err);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = (r: PaymentRequest, approve: boolean) => {
    let reason: string | null = null;
    if (!approve) {
      reason = window.prompt(t('rejectReason', { name: r.studentName }));
      if (!reason || reason.trim().length < 3) return;
    }
    setBusy(true);
    setError(null);
    api(`${base}/payment-requests/${r.id}/${approve ? 'approve' : 'reject'}`, {
      method: 'POST',
      ...(reason ? { body: { reason: reason.trim() } } : {}),
    })
      .then(async () => {
        await load();
        onDecided();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-semibold">{t('pendingTitle', { count: requests.length })}</h2>
      <ErrorMessage error={error} />
      <ul className="flex flex-col gap-2">
        {requests.map((r) => (
          <li key={r.id} className="rounded-xl bg-surface p-3 text-sm shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold">{r.studentName}</span>
              <span className="font-semibold">
                {formatMoney(r.amountPiastres, locale, r.currency)}
              </span>
            </div>
            <p className="text-muted">
              {tp(`methods.${r.method}`)} · <Ltr>{r.reference}</Ltr>
              {r.note ? ` · ${r.note}` : ''}
            </p>
            <FileList
              base={base}
              owner="payment-requests"
              ownerId={r.id}
              canUpload={false}
              accept=""
            />
            {r.duplicateReference ? (
              <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-amber-900">{t('duplicate')}</p>
            ) : null}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(r, true)}
                className="rounded-lg bg-brand px-3 py-1 text-brand-contrast"
              >
                {t('approve')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => decide(r, false)}
                className="rounded-lg border px-3 py-1"
              >
                {t('reject')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
