'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { Locale } from '../../i18n/routing';
import { formatMoney } from '../../lib/format';
import { useEffect, useState } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { ErrorMessage } from '../form';

interface TeacherPage {
  slug: string;
  name: string;
  bio: string | null;
  subjects: string[];
  prices: { name: string; amountPiastres: number; currency: string; description: string | null }[];
}

interface JoinResult {
  workspaceId: string;
  workspaceName: string;
  status: 'active' | 'pending' | 'suspended';
}

/** The public teacher page with the join action (REQ-CONTENT-003). No sign-in needed to view. */
export function TeacherPageView({ slug }: { slug: string }) {
  const t = useTranslations('teacherPage');
  const tj = useTranslations('joinTeacher');
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [page, setPage] = useState<TeacherPage | null>(null);
  const [missing, setMissing] = useState(false);
  const [result, setResult] = useState<JoinResult | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const here = `/t/${slug}`;

  useEffect(() => {
    api<TeacherPage>(`/public/teachers/${encodeURIComponent(slug)}`)
      .then(setPage)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else setError(err);
      });
  }, [slug]);

  const join = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await api<JoinResult>('/join', { method: 'POST', body: { slug } }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.push(`/login?next=${encodeURIComponent(here)}`);
        return;
      }
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="mb-2 text-xl font-semibold">{t('notFound')}</h1>
        <Link href="/" className="text-sm underline">
          {t('home')}
        </Link>
      </main>
    );
  }

  if (!page) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <ErrorMessage error={error} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h1 className="mb-3 text-2xl font-semibold">{page.name}</h1>
        {page.subjects.length > 0 ? (
          <ul className="mb-4 flex flex-wrap gap-2" aria-label={t('subjects')}>
            {page.subjects.map((subject) => (
              <li key={subject} className="rounded-full bg-gray-100 px-3 py-1 text-sm">
                {subject}
              </li>
            ))}
          </ul>
        ) : null}
        {page.bio ? <p className="whitespace-pre-line text-muted">{page.bio}</p> : null}
      </section>

      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <ErrorMessage error={error} />
        {result ? (
          <>
            <p role="status" className="mb-4">
              {result.status === 'active'
                ? tj('joined', { name: result.workspaceName })
                : tj('pending', { name: result.workspaceName })}
            </p>
            <Link
              href={result.status === 'active' ? `/w/${result.workspaceId}` : '/account'}
              className="block rounded-lg bg-brand px-4 py-3 text-center font-semibold text-brand-contrast"
            >
              {result.status === 'active' ? tj('open') : tj('backToAccount')}
            </Link>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">{t('joinExplain')}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => void join()}
              className="mb-3 w-full rounded-lg bg-brand px-4 py-3 font-semibold text-brand-contrast"
            >
              {t('join')}
            </button>
            <p className="text-center text-sm">
              {t('noAccount')}{' '}
              <Link href={`/register?next=${encodeURIComponent(here)}`} className="underline">
                {t('register')}
              </Link>
            </p>
          </>
        )}
      </section>
      {page.prices.length > 0 ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-3 font-semibold">{t('prices')}</h2>
          <ul className="flex flex-col gap-2">
            {page.prices.map((price) => (
              <li key={price.name} className="flex items-start justify-between gap-3">
                <div>
                  <p>{price.name}</p>
                  {price.description ? (
                    <p className="text-sm text-muted">{price.description}</p>
                  ) : null}
                </div>
                <span className="shrink-0 font-semibold">
                  {formatMoney(price.amountPiastres, locale, price.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
