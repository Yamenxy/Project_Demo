'use client';

import { toWesternDigits } from '@lms/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { ErrorMessage, Field, Select, SubmitButton } from '../form';
import { PLANS, STATUS_STYLE, type WorkspaceSummary } from './types';

const publicPath = (slug: string) => `/t/${slug}`;

/** Platform owners' home: every teacher workspace, and setting up a new teacher. */
export function PlatformConsole() {
  const t = useTranslations('platform');
  const format = useFormatter();
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [createError, setCreateError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setWorkspaces(
        (await api<{ workspaces: WorkspaceSummary[] }>('/platform/workspaces')).workspaces,
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setError(err);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const value = (name: string) =>
      (form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | null)?.value ?? '';
    setBusy(true);
    setCreateError(null);
    try {
      const { id } = await api<{ id: string }>('/platform/workspaces', {
        method: 'POST',
        body: {
          name: value('name'),
          slug: value('slug'),
          ownerPhone: toWesternDigits(value('ownerPhone')),
          plan: value('plan'),
        },
      });
      router.push(`/platform/${id}`);
    } catch (err) {
      setCreateError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        <Link href="/account" className="text-sm underline">
          {t('myAccount')}
        </Link>
      </div>
      <ErrorMessage error={error} />

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t('workspaces')}</h2>
        {workspaces && workspaces.length === 0 ? (
          <p className="text-muted">{t('noWorkspaces')}</p>
        ) : null}
        <ul className="grid gap-3 sm:grid-cols-2">
          {(workspaces ?? []).map((w) => (
            <li key={w.id}>
              <Link
                href={`/platform/${w.id}`}
                className="block rounded-2xl bg-surface p-4 shadow-sm hover:ring-2 hover:ring-brand"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">{w.name}</p>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[w.status]}`}>
                    {t(`status.${w.status}`)}
                  </span>
                </div>
                <p className="text-sm text-muted">{w.ownerName}</p>
                <p className="mt-2 text-sm">
                  {t(`plan.${w.plan}`)} ·{' '}
                  {t('until', {
                    date: format.dateTime(new Date(w.periodEndsAt), { dateStyle: 'medium' }),
                  })}
                </p>
                <p className="text-sm text-muted">
                  {t('studentsCount', { count: w.members.student ?? 0 })} ·{' '}
                  {t('staffCount', {
                    count: (w.members.class_teacher ?? 0) + (w.members.assistant ?? 0),
                  })}
                </p>
                {w.suspension ? (
                  <p className="mt-2 text-sm font-semibold text-red-700">
                    {t(`suspension.${w.suspension}`)}
                  </p>
                ) : null}
                <p className="mt-1 text-xs text-muted">
                  <Ltr>{publicPath(w.slug)}</Ltr>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-1 font-semibold">{t('newTeacher')}</h2>
        <p className="mb-4 text-sm text-muted">{t('newTeacherExplain')}</p>
        <form onSubmit={(event) => void create(event)} noValidate>
          <ErrorMessage error={createError} />
          <Field label={t('workspaceName')} name="name" required />
          <Field label={t('slug')} name="slug" dir="ltr" hint={t('slugHint')} required />
          <Field
            label={t('ownerPhone')}
            name="ownerPhone"
            type="tel"
            inputMode="tel"
            dir="ltr"
            required
          />
          <Select
            label={t('planLabel')}
            name="plan"
            options={PLANS.map((plan) => ({ value: plan, label: t(`plan.${plan}`) }))}
          />
          <SubmitButton busy={busy}>{t('create')}</SubmitButton>
        </form>
      </section>
    </main>
  );
}
