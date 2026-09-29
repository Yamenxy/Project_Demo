'use client';

import { useTranslations } from 'next-intl';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Link, usePathname, useRouter } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { ErrorMessage } from '../form';

export type Role = 'owner' | 'class_teacher' | 'assistant' | 'student';

export interface WorkspaceContextValue {
  workspace: { id: string; slug: string; name: string; suspended: boolean };
  membership: { id: string; role: Role; paused: boolean };
  permissions: string[];
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
    {
      href: `${base}/students`,
      label: t('nav.students'),
      visible: (c) =>
        c.membership.role === 'owner' ||
        c.permissions.includes('enrollment.manage') ||
        c.permissions.includes('students.import'),
    },
    { href: `${base}/staff`, label: t('nav.staff'), visible: (c) => c.membership.role === 'owner' },
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
            <Link href="/account" className="text-sm underline">
              {t('myAccount')}
            </Link>
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
                      pathname === item.href ? 'font-semibold text-brand underline' : 'text-muted'
                    }
                  >
                    {item.label}
                  </Link>
                ))}
            </nav>
          ) : null}
        </header>
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
