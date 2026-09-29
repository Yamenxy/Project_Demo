'use client';

import { useTranslations } from 'next-intl';
import { Link } from '../../i18n/navigation';
import { useWorkspace } from './workspace-shell';

/** Workspace home. Richer dashboards arrive with classes, attendance and content. */
export function WorkspaceHome() {
  const t = useTranslations('workspace');
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;

  if (membership.role === 'student') {
    return (
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h1 className="mb-2 text-xl font-semibold">
          {t('studentWelcome', { name: workspace.name })}
        </h1>
        <p className="text-muted">{membership.paused ? t('studentPaused') : t('studentSoon')}</p>
      </section>
    );
  }

  const cards = [
    {
      href: `${base}/students`,
      title: t('nav.students'),
      text: t('cards.students'),
      show: membership.role === 'owner' || permissions.includes('enrollment.manage'),
    },
    {
      href: `${base}/staff`,
      title: t('nav.staff'),
      text: t('cards.staff'),
      show: membership.role === 'owner',
    },
    {
      href: `${base}/billing`,
      title: t('nav.billing'),
      text: t('cards.billing'),
      show: membership.role === 'owner',
    },
  ].filter((card) => card.show);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('staffWelcome')}</h1>
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
    </div>
  );
}
