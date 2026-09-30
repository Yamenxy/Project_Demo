'use client';

import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, usePathname, useRouter } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { ErrorMessage } from '../form';
import { WorkspaceSwitcher } from './workspace-switcher';

export type Role = 'owner' | 'class_teacher' | 'assistant' | 'student';

export interface WorkspaceContextValue {
  workspace: { id: string; slug: string; name: string; suspended: boolean };
  membership: { id: string; role: Role; paused: boolean };
  permissions: string[];
  /** Platform support reading the workspace: read-only (REQ-RBAC-003). */
  support: boolean;
  reload: () => Promise<void>;
}

const Context = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace(): WorkspaceContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('useWorkspace must be used inside WorkspaceShell');
  return value;
}

interface NavItem {
  href: string;
  label: string;
  visible: (ctx: WorkspaceContextValue) => boolean;
}

/**
 * The frame of every workspace page: loads "who am I here" once (the API still checks every
 * request), shows the navigation the role allows, and the neutral suspension notice (D12a).
 */
export function WorkspaceShell({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: ReactNode;
}) {
  const t = useTranslations('workspace');
  const router = useRouter();
  const pathname = usePathname();
  const [value, setValue] = useState<WorkspaceContextValue | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    try {
      const context = await api<Omit<WorkspaceContextValue, 'reload'>>(`/w/${workspaceId}/context`);
      setValue({ ...context, reload: load });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
      } else setError(err);
    }
  }, [workspaceId, router, pathname]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!value) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <ErrorMessage error={error} />
        {error instanceof ApiError && error.code === 'guardian_consent_required' ? (
          <Link
            href="/consent"
            className="mb-4 block rounded-lg bg-brand px-4 py-3 text-center font-semibold text-brand-contrast"
          >
            {t('giveConsent')}
          </Link>
        ) : null}
        {error ? (
          <Link href="/account" className="text-sm underline">
            {t('backToAccount')}
          </Link>
        ) : null}
      </main>
    );
  }

  const base = `/w/${workspaceId}`;
  const staffRole = value.membership.role !== 'student';
  const nav: NavItem[] = [
    { href: base, label: t('nav.home'), visible: () => true },
    { href: `${base}/classes`, label: t('nav.classes'), visible: () => true },
    {
      href: `${base}/groups`,
      label: t('nav.groups'),
      visible: (c) => c.membership.role === 'owner' || c.permissions.includes('access.groups'),
    },
    {
      href: `${base}/courses`,
      label: t('nav.courses'),
      visible: (c) => c.membership.role === 'owner' || c.permissions.includes('content.edit'),
    },
    { href: `${base}/schedule`, label: t('nav.schedule'), visible: () => true },
    {
      href: `${base}/announcements`,
      label: t('nav.announcements'),
      visible: (c) => c.membership.role === 'owner' || c.permissions.includes('announcements.post'),
    },
    {
      href: `${base}/students`,
      label: t('nav.students'),
      visible: (c) =>
        c.membership.role === 'owner' ||
        c.permissions.includes('enrollment.manage') ||
        c.permissions.includes('students.import'),
    },
    {
      href: `${base}/payments`,
      label: t('nav.payments'),
      visible: (c) =>
        c.membership.role === 'owner' ||
        c.permissions.includes('payments.record') ||
        c.permissions.includes('payments.view'),
    },
    {
      href: `${base}/cash`,
      label: t('nav.cash'),
      visible: (c) =>
        c.membership.role === 'owner' ||
        c.permissions.includes('payments.record') ||
        c.permissions.includes('finance.view'),
    },
    {
      href: `${base}/prices`,
      label: t('nav.prices'),
      visible: (c) => c.membership.role === 'owner',
    },
    { href: `${base}/staff`, label: t('nav.staff'), visible: (c) => c.membership.role === 'owner' },
    {
      href: `${base}/audit-log`,
      label: t('nav.auditLog'),
      visible: (c) => c.membership.role === 'owner',
    },
    {
      href: `${base}/comments`,
      label: t('nav.comments'),
      visible: (c) => c.membership.role === 'owner',
    },
    {
      href: `${base}/billing`,
      label: t('nav.billing'),
      visible: (c) => c.membership.role === 'owner',
    },
  ];

  return (
    <Context.Provider value={value}>
      <div className="min-h-dvh">
        <header className="border-b bg-surface">
          <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div>
              <p className="font-semibold">{value.workspace.name}</p>
              <p className="text-xs text-muted">{t(`roles.${value.membership.role}`)}</p>
            </div>
            <div className="flex items-center gap-3">
              <WorkspaceSwitcher currentId={value.workspace.id} />
              <Link href="/account" className="text-sm underline">
                {t('myAccount')}
              </Link>
            </div>
          </div>
          {staffRole ? (
            <nav className="mx-auto flex max-w-3xl gap-4 overflow-x-auto px-4 pb-2 text-sm">
              {nav
                .filter((item) => item.visible(value))
                .map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={
                      pathname === item.href
                        ? 'shrink-0 whitespace-nowrap font-semibold text-brand underline'
                        : 'shrink-0 whitespace-nowrap text-muted'
                    }
                  >
                    {item.label}
                  </Link>
                ))}
            </nav>
          ) : null}
        </header>
        {value.support ? (
          <p
            role="status"
            className="mx-auto mt-4 max-w-3xl rounded-lg bg-amber-100 px-4 py-3 font-semibold text-amber-900"
          >
            {t('supportBanner')}
          </p>
        ) : null}
        {value.workspace.suspended ? (
          <p
            role="status"
            className="mx-auto mt-4 max-w-3xl rounded-lg bg-amber-50 px-4 py-3 text-amber-900"
          >
            {value.membership.role === 'owner' ? t('suspendedOwner') : t('suspended')}
          </p>
        ) : null}
        <div className="mx-auto max-w-3xl px-4 py-6">{children}</div>
      </div>
    </Context.Provider>
  );
}
