'use client';

import { toWesternDigits } from '@lms/shared';
import { useFormatter, useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Locale } from '../../i18n/routing';
import { Link } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { formatMoney, parseMoney } from '../../lib/format';
import { ErrorMessage, SubmitButton } from '../form';
import { TIME_ZONE } from './class-schedule';
import { MyPaymentRequests, PendingRequests } from './payment-requests';
import type { PriceItem } from './price-list-view';
import { useWorkspace } from './workspace-shell';

export interface LedgerEntry {
  id: string;
  receiptNumber: number;
  kind: 'payment' | 'reversal';
  membershipId: string;
  studentName: string;
  amountPiastres: number;
  currency: string;
  method: 'cash' | 'transfer' | 'wallet' | 'other';
  collectedBy: { userId: string; name: string } | null;
  itemName: string | null;
  note: string | null;
  reversesId: string | null;
  reversed: boolean;
  recordedAt: string;
}

interface Candidate {
  membershipId: string;
  name: string;
  platformCode: string | null;
}

const METHODS = ['cash', 'transfer', 'wallet', 'other'] as const;

/** Recording payments and the ledger (REQ-PAY-003, -004, -006, -007). */
export function PaymentsView() {
  const t = useTranslations('payments');
  const format = useFormatter();
  const locale = useLocale() as Locale;
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const isOwner = membership.role === 'owner';
  const canRecord = isOwner || permissions.includes('payments.record');
  const canView = isOwner || permissions.includes('payments.view');
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [items, setItems] = useState<PriceItem[]>([]);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Candidate[]>([]);
  const [student, setStudent] = useState<Candidate | null>(null);
  const [amount, setAmount] = useState('');
  const [itemId, setItemId] = useState('');
  const [done, setDone] = useState<{ id: string; receiptNumber: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      if (canView) setEntries((await api<{ entries: LedgerEntry[] }>(`${base}/payments`)).entries);
      if (canRecord) setItems((await api<{ items: PriceItem[] }>(`${base}/price-items`)).items);
    } catch (err) {
      setError(err);
    }
  }, [base, canView, canRecord]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!canRecord || query.trim().length < 2) {
      setFound([]);
      return;
    }
    const timer = setTimeout(() => {
      api<{ students: Candidate[] }>(
        `${base}/payments/students?q=${encodeURIComponent(toWesternDigits(query.trim()))}`,
      )
        .then((data) => setFound(data.students))
        .catch(() => setFound([]));
    }, 250);
    return () => clearTimeout(timer);
  }, [base, query, canRecord]);

  const money = (e: { amountPiastres: number; currency: string }) =>
    formatMoney(e.amountPiastres, locale, e.currency);

  const record = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const method = (form.elements.namedItem('method') as HTMLSelectElement).value;
    const note = (form.elements.namedItem('note') as HTMLInputElement).value;
    const piastres = parseMoney(amount);
    if (!student) return;
    if (piastres === null || piastres === 0) {
      setError(new ApiError(400, 'invalid_amount'));
      return;
    }
    setBusy(true);
    setError(null);
    api<{ id: string; receiptNumber: number }>(`${base}/payments`, {
      method: 'POST',
      body: {
        membershipId: student.membershipId,
        amountPiastres: piastres,
        method,
        ...(itemId ? { priceItemId: itemId } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    })
      .then(async (result) => {
        setDone(result);
        setStudent(null);
        setQuery('');
        setAmount('');
        setItemId('');
        form.reset();
        await load();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const reverse = (entry: LedgerEntry) => {
    const reason = window.prompt(t('reverseReason', { number: entry.receiptNumber }));
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    api(`${base}/payments/${entry.id}/reverse`, { method: 'POST', body: { reason: reason.trim() } })
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />

      {canRecord ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-1 font-semibold">{t('recordTitle')}</h2>
          <p className="mb-4 text-sm text-muted">{t('recordExplain')}</p>
          {done ? (
            <p role="status" className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">
              {t('recorded', { number: done.receiptNumber })}{' '}
              <Link href={`${base}/payments/${done.id}`} className="underline">
                {t('openReceipt')}
              </Link>
            </p>
          ) : null}
          <form onSubmit={record} noValidate className="flex flex-col gap-3">
            {student ? (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <span className="font-semibold">{student.name}</span>
                <button
                  type="button"
                  onClick={() => setStudent(null)}
                  className="text-sm underline"
                >
                  {t('change')}
                </button>
              </div>
            ) : (
              <div>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('findStudent')}
                  aria-label={t('findStudent')}
                  className="w-full rounded-lg border px-3 py-2"
                />
                <ul className="mt-2 flex flex-col gap-1">
                  {found.map((c) => (
                    <li key={c.membershipId}>
                      <button
                        type="button"
                        onClick={() => setStudent(c)}
                        className="w-full rounded-lg border px-3 py-2 text-start"
                      >
                        {c.name}{' '}
                        {c.platformCode ? (
                          <span className="text-xs text-muted">
                            <Ltr>{c.platformCode}</Ltr>
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {items.length > 0 ? (
              <label className="flex flex-col gap-1 text-sm font-semibold">
                {t('item')}
                <select
                  value={itemId}
                  onChange={(event) => {
                    setItemId(event.target.value);
                    const item = items.find((i) => i.id === event.target.value);
                    if (item) setAmount(String(item.amountPiastres / 100));
                  }}
                  className="rounded-lg border px-3 py-2 font-normal"
                >
                  <option value="">{t('noItem')}</option>
                  {items.map((i) => (
                    <option key={i.id} value={i.id}>
                      {t('itemOption', { name: i.name, price: money(i) })}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t('amount')}
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                dir="ltr"
                required
                className="rounded-lg border px-3 py-2 font-normal"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t('method')}
              <select name="method" className="rounded-lg border px-3 py-2 font-normal">
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`methods.${m}`)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm font-semibold">
              {t('note')}
              <input name="note" className="rounded-lg border px-3 py-2 font-normal" />
            </label>
            <SubmitButton busy={busy || !student}>{t('record')}</SubmitButton>
          </form>
        </section>
      ) : null}

      {isOwner || permissions.includes('payments.confirm') ? (
        <PendingRequests base={base} onDecided={() => void load()} />
      ) : null}

      {canView ? (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">{t('ledgerTitle')}</h2>
          {entries.length === 0 ? <p className="text-muted">{t('empty')}</p> : null}
          <ul className="flex flex-col gap-2">
            {entries.map((e) => (
              <li
                key={e.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-3 shadow-sm ${e.kind === 'reversal' ? 'border-s-4 border-red-400' : ''}`}
              >
                <Link href={`${base}/payments/${e.id}`} className="flex flex-col">
                  <span className="font-semibold">
                    {t('receiptNo', { number: e.receiptNumber })} · {e.studentName}
                  </span>
                  <span className="text-xs text-muted">
                    {format.dateTime(new Date(e.recordedAt), {
                      timeZone: TIME_ZONE,
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}{' '}
                    · {t(`methods.${e.method}`)}
                    {e.collectedBy ? ` · ${t('collectedBy', { name: e.collectedBy.name })}` : ''}
                  </span>
                </Link>
                <div className="flex items-center gap-2">
                  <span className={`font-semibold ${e.kind === 'reversal' ? 'text-red-700' : ''}`}>
                    {e.kind === 'reversal' ? t('minus', { amount: money(e) }) : money(e)}
                  </span>
                  {isOwner && e.kind === 'payment' && !e.reversed ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => reverse(e)}
                      className="rounded-lg border px-2 py-1 text-xs"
                    >
                      {t('reverse')}
                    </button>
                  ) : null}
                  {e.reversed ? <span className="text-xs text-muted">{t('reversed')}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** One receipt, for staff or the student it belongs to (REQ-PAY-004). */
export function ReceiptView({ paymentId }: { paymentId: string }) {
  const t = useTranslations('payments');
  const format = useFormatter();
  const locale = useLocale() as Locale;
  const { workspace } = useWorkspace();
  const [entry, setEntry] = useState<LedgerEntry | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<LedgerEntry>(`/w/${workspace.id}/payments/${paymentId}`).then(setEntry).catch(setError);
  }, [workspace.id, paymentId]);

  if (!entry) return <ErrorMessage error={error} />;
  const rows: [string, string][] = [
    [t('student'), entry.studentName],
    [t('amount'), formatMoney(entry.amountPiastres, locale, entry.currency)],
    [t('method'), t(`methods.${entry.method}`)],
    ...(entry.itemName ? ([[t('item'), entry.itemName]] as [string, string][]) : []),
    ...(entry.collectedBy
      ? ([[t('collector'), entry.collectedBy.name]] as [string, string][])
      : []),
    [
      t('date'),
      format.dateTime(new Date(entry.recordedAt), {
        timeZone: TIME_ZONE,
        dateStyle: 'long',
        timeStyle: 'short',
      }),
    ],
    ...(entry.note ? ([[t('note'), entry.note]] as [string, string][]) : []),
  ];
  return (
    <article className="mx-auto max-w-md rounded-2xl bg-surface p-6 shadow-sm">
      <p className="text-sm text-muted">{workspace.name}</p>
      <h1 className="mb-4 text-xl font-semibold">
        {entry.kind === 'reversal' ? t('reversalTitle') : t('receiptTitle')}{' '}
        {t('receiptNo', { number: entry.receiptNumber })}
      </h1>
      <dl className="grid grid-cols-2 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {entry.reversed ? <p className="mt-4 text-sm text-red-700">{t('reversed')}</p> : null}
      <button
        type="button"
        onClick={() => window.print()}
        className="mt-6 rounded-lg border px-4 py-2 text-sm print:hidden"
      >
        {t('print')}
      </button>
    </article>
  );
}

/** A student's own receipts. */
export function MyPaymentsView() {
  const t = useTranslations('payments');
  const locale = useLocale() as Locale;
  const { workspace } = useWorkspace();
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ entries: LedgerEntry[] }>(`/w/${workspace.id}/my/payments`)
      .then((data) => setEntries(data.entries))
      .catch(setError);
  }, [workspace.id]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('myTitle')}</h1>
      <MyPaymentRequests base={`/w/${workspace.id}`} />
      <ErrorMessage error={error} />
      {entries.length === 0 ? <p className="text-muted">{t('empty')}</p> : null}
      <ul className="flex flex-col gap-2">
        {entries.map((e) => (
          <li key={e.id}>
            <Link
              href={`/w/${workspace.id}/payments/${e.id}`}
              className="flex justify-between rounded-xl bg-surface p-3 shadow-sm"
            >
              <span>{t('receiptNo', { number: e.receiptNumber })}</span>
              <span className="font-semibold">
                {e.kind === 'reversal'
                  ? t('minus', { amount: formatMoney(e.amountPiastres, locale, e.currency) })
                  : formatMoney(e.amountPiastres, locale, e.currency)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
