'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import type { ConsentStatus } from '../auth/consent-view';
import { useWorkspace } from './workspace-shell';

interface StudentSummary {
  active: number;
  pending: number;
  managed: number;
  missingConsent: number;
}

/** Workspace home: a dashboard for staff, a welcome for students (review MISS-05). */
export function WorkspaceHome() {
  const { membership } = useWorkspace();
  return membership.role === 'student' ? <StudentHome /> : <StaffHome />;
}

function StudentHome() {
  const t = useTranslations('workspace');
  const { workspace, membership } = useWorkspace();
  const [code, setCode] = useState<string | null>(null);
  const [consent, setConsent] = useState<ConsentStatus | null>(null);

  useEffect(() => {
    api<{ user: { platformCode: string } }>('/auth/me')
      .then((me) => setCode(me.user.platformCode))
      .catch(() => setCode(null));
    api<ConsentStatus>('/auth/consent')
      .then(setConsent)
      .catch(() => setConsent(null));
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-semibold">
          {t('studentWelcome', { name: workspace.name })}
        </h1>
        <p className="text-muted">{membership.paused ? t('studentPaused') : t('studentSoon')}</p>
        {code ? (
          <p className="mt-4 text-sm">
            {t('yourCode')}{' '}
            <span className="font-mono text-base font-semibold">
              <Ltr>{code}</Ltr>
            </span>
          </p>
        ) : null}
      </section>
      {consent?.state === 'needed' ? (
        <Link
          href="/consent"
          className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800"
        >
          {t('consentReminder')}
        </Link>
      ) : null}
      <Link href="/join" className="text-center text-sm underline">
        {t('joinAnother')}
      </Link>
    </div>
  );
}

function StaffHome() {
  const t = useTranslations('workspace');
  const { workspace, membership, permissions } = useWorkspace();
  const [summary, setSummary] = useState<StudentSummary | null>(null);
  const base = `/w/${workspace.id}`;
  const isOwner = membership.role === 'owner';

  useEffect(() => {
    api<{ students: StudentSummary | null }>(`${base}/summary`)
      .then((data) => setSummary(data.students))
      .catch(() => setSummary(null));
  }, [base]);

  const tiles = summary
    ? [
        {
          label: t('tiles.pending'),
          value: summary.pending,
          href: `${base}/students?status=pending`,
        },
        {
          label: t('tiles.missingConsent'),
          value: summary.missingConsent,
          href: `${base}/students?consent=missing`,
        },
        { label: t('tiles.active'), value: summary.active, href: `${base}/students` },
        { label: t('tiles.managed'), value: summary.managed, href: `${base}/students` },
      ]
    : [];

  const cards = [
    { href: `${base}/classes`, title: t('nav.classes'), text: t('cards.classes'), show: true },
    {
      href: `${base}/students`,
      title: t('nav.students'),
      text: t('cards.students'),
      show:
        isOwner ||
        permissions.includes('enrollment.manage') ||
        permissions.includes('students.import'),
    },
    { href: `${base}/staff`, title: t('nav.staff'), text: t('cards.staff'), show: isOwner },
    { href: `${base}/billing`, title: t('nav.billing'), text: t('cards.billing'), show: isOwner },
  ].filter((card) => card.show);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('staffWelcome')}</h1>
      {tiles.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <li key={tile.label}>
              <Link
                href={tile.href}
                className={`block rounded-2xl p-4 shadow-sm hover:ring-2 hover:ring-brand ${tile.value > 0 && tile.href.includes('?') ? 'bg-amber-50' : 'bg-surface'}`}
              >
                <p className="text-2xl font-semibold">{tile.value}</p>
                <p className="text-sm text-muted">{tile.label}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {cards.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {cards.map((card) => (
            <li key={card.href}>
              <Link
                href={card.href}
                className="block rounded-2xl bg-surface p-5 shadow-sm hover:ring-2 hover:ring-brand"
              >
                <p className="font-semibold">{card.title}</p>
                <p className="text-sm text-muted">{card.text}</p>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">{t('helperSoon')}</p>
      )}
    </div>
  );
}
