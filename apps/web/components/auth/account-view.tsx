'use client';

import { toWesternDigits } from '@lms/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useRouter } from '../../i18n/navigation';
import type { ConsentStatus } from './consent-view';
import { api, ApiError, type DeviceSummary, type UserSummary } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { ErrorMessage, Field, SubmitButton } from '../form';
import { clearDeviceData } from '../../lib/push';

interface MyWorkspace {
  workspaceId: string;
  name: string;
  role: 'owner' | 'class_teacher' | 'assistant' | 'student';
  status: string;
}

interface Me {
  user: UserSummary;
  secondFactorPending: boolean;
}

export function AccountView() {
  const t = useTranslations('account');
  const format = useFormatter();
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [devices, setDevices] = useState<DeviceSummary[]>([]);
  const [unread, setUnread] = useState(0);
  const [platformOwner, setPlatformOwner] = useState(false);
  const [workspaces, setWorkspaces] = useState<MyWorkspace[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [consent, setConsent] = useState<ConsentStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const current = await api<Me>('/auth/me');
      if (current.secondFactorPending) {
        router.replace('/two-factor');
        return;
      }
      setMe(current);
      setDevices((await api<{ devices: DeviceSummary[] }>('/auth/devices')).devices);
      setUnread((await api<{ unread: number }>('/notifications')).unread);
      const mine = await api<{ platformOwner: boolean; workspaces: MyWorkspace[] }>(
        '/me/workspaces',
      );
      setPlatformOwner(mine.platformOwner);
      setWorkspaces(mine.workspaces);
      if (mine.workspaces.some((w) => w.role === 'student')) {
        setConsent(await api<ConsentStatus>('/auth/consent'));
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) router.replace('/login');
      else setError(err);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const removeDevice = async (id: string) => {
    try {
      await api(`/auth/devices/${id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const signOut = async (everywhere: boolean) => {
    await clearDeviceData();
    await api(everywhere ? '/auth/logout-all' : '/auth/logout', { method: 'POST' }).catch(
      () => undefined,
    );
    router.replace('/login');
  };

  if (!me) {
    return (
      <main className="mx-auto max-w-md px-4 py-10">
        <ErrorMessage error={error} />
      </main>
    );
  }

  return (
    <main className="mx-auto flex max-w-md flex-col gap-6 px-4 py-10">
      <ErrorMessage error={error} />
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <div className="mb-2 flex items-start justify-between gap-3">
          <h1 className="text-xl font-semibold">{me.user.nameAr}</h1>
          <Link href="/notifications" className="shrink-0 rounded-lg border px-3 py-1 text-sm">
            {t('notifications', { count: unread })}
          </Link>
        </div>
        <p className="text-muted">
          {t('platformCode')} <Ltr>{me.user.platformCode}</Ltr>
        </p>
        {me.user.phoneVerified ? (
          <p className="mt-2 text-sm text-brand">{t('phoneVerified')}</p>
        ) : (
          <Link href="/verify-phone" className="mt-2 block text-sm font-semibold underline">
            {t('verifyPhoneNow')}
          </Link>
        )}
      </section>

      {consent && (consent.state === 'needed' || consent.state === 'overdue') ? (
        <Link
          href="/consent"
          className={`rounded-2xl p-4 text-sm font-semibold ${consent.state === 'overdue' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}
        >
          {consent.state === 'overdue' ? t('consentOverdue') : t('consentNeeded')}
        </Link>
      ) : null}

      {workspaces.length > 0 ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-3 font-semibold">{t('myWorkspaces')}</h2>
          <ul className="flex flex-col gap-2">
            {workspaces.map((w) => (
              <li key={w.workspaceId}>
                <Link
                  href={`/w/${w.workspaceId}`}
                  className="flex items-center justify-between rounded-lg border px-3 py-2 hover:border-brand"
                >
                  <span>{w.name}</span>
                  <span className="text-sm text-muted">
                    {w.status === 'pending' ? t('waitingApproval') : t(`roles.${w.role}`)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Link href="/join" className="rounded-lg border px-4 py-3 text-center font-semibold">
        {t('joinTeacher')}
      </Link>

      {platformOwner ? (
        <Link
          href="/platform"
          className="rounded-lg bg-brand px-4 py-3 text-center font-semibold text-brand-contrast"
        >
          {t('platformConsole')}
        </Link>
      ) : null}

      <TwoFactorSection enabled={me.user.twoFactorEnabled} onChange={load} />

      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">{t('devicesTitle')}</h2>
        <ul className="flex flex-col gap-3">
          {devices.map((device) => (
            <li key={device.id} className="flex items-center justify-between gap-3">
              <div>
                <p>{device.label ?? t('unknownDevice')}</p>
                <p className="text-sm text-muted">
                  {device.current
                    ? t('thisDevice')
                    : t('lastSeen', {
                        when: format.dateTime(new Date(device.lastSeenAt), {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }),
                      })}
                </p>
              </div>
              {device.current ? null : (
                <button
                  type="button"
                  onClick={() => void removeDevice(device.id)}
                  className="rounded-lg border px-3 py-2 text-sm"
                >
                  {t('removeDevice')}
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => void signOut(false)}
          className="rounded-lg border px-4 py-3"
        >
          {t('signOut')}
        </button>
        <button
          type="button"
          onClick={() => void signOut(true)}
          className="rounded-lg border px-4 py-3 text-red-700"
        >
          {t('signOutEverywhere')}
        </button>
      </div>
    </main>
  );
}

function TwoFactorSection({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: () => Promise<void>;
}) {
  const t = useTranslations('account');
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setError(null);
    try {
      const result = await api<{ secret: string; otpauthUri: string }>('/auth/2fa/setup', {
        method: 'POST',
      });
      // Loaded only here, so the QR library stays out of every other page's bundle.
      const { toDataURL } = await import('qrcode');
      setSetup({
        secret: result.secret,
        qr: await toDataURL(result.otpauthUri, { margin: 1, width: 200 }),
      });
    } catch (err) {
      setError(err);
    }
  };

  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const field = event.currentTarget.elements.namedItem('code');
    const code = field instanceof HTMLInputElement ? toWesternDigits(field.value) : '';
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ recoveryCodes: string[] }>('/auth/2fa/enable', {
        method: 'POST',
        body: { code },
      });
      setCodes(result.recoveryCodes);
      setSetup(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl bg-surface p-6 shadow-sm">
      <h2 className="mb-2 font-semibold">{t('twoFactorTitle')}</h2>
      <ErrorMessage error={error} />
      {codes ? (
        <div>
          <p className="mb-3 text-sm">{t('recoveryCodesExplain')}</p>
          <ul className="grid grid-cols-2 gap-2 font-mono text-sm" dir="ltr">
            {codes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              setCodes(null);
              void onChange();
            }}
            className="mt-4 w-full rounded-lg border px-4 py-3"
          >
            {t('recoveryCodesSaved')}
          </button>
        </div>
      ) : enabled ? (
        <p className="text-sm text-brand">{t('twoFactorOn')}</p>
      ) : setup ? (
        <form onSubmit={(event) => void confirm(event)} noValidate>
          <p className="mb-2 text-sm">{t('twoFactorSetupExplain')}</p>
          <img
            src={setup.qr}
            alt={t('twoFactorQrAlt')}
            width={200}
            height={200}
            className="mx-auto mb-3"
          />
          <p className="mb-1 text-sm text-muted">{t('twoFactorKeyLabel')}</p>
          <p className="mb-4 break-all rounded-lg bg-gray-100 p-3 font-mono text-sm" dir="ltr">
            {setup.secret}
          </p>
          <Field label={t('twoFactorCode')} name="code" inputMode="numeric" dir="ltr" required />
          <SubmitButton busy={busy}>{t('twoFactorConfirm')}</SubmitButton>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => void start()}
          className="w-full rounded-lg border px-4 py-3"
        >
          {t('twoFactorStart')}
        </button>
      )}
    </section>
  );
}
