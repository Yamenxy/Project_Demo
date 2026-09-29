'use client';

import {
  isGrantable,
  PERMISSION_KEYS,
  toWesternDigits,
  WORKSPACE_ONLY,
  type PermissionKey,
} from '@lms/shared';
import { useFormatter, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { ErrorMessage, Field, Select, SubmitButton } from '../form';
import { absoluteUrl, ShareLink } from './share-link';
import { useWorkspace } from './workspace-shell';

type StaffRole = 'class_teacher' | 'assistant';

interface StaffMember {
  membershipId: string;
  name: string;
  phoneE164: string;
  role: StaffRole;
  granted: PermissionKey[];
  classIds: string[];
  defaults: PermissionKey[];
}

interface Invitation {
  id: string;
  phoneE164: string;
  role: StaffRole;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

const permissionLabelKey = (key: PermissionKey) => `permissions.${key.replace('.', '_')}`;

/** Owner's staff page (REQ-USER-005, REQ-RBAC-002, REQ-RBAC-006). */
export function StaffView() {
  const t = useTranslations('staff');
  const format = useFormatter();
  const { workspace } = useWorkspace();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [classes, setClasses] = useState<{ id: string; name: string }[]>([]);
  const base = `/w/${workspace.id}`;

  const load = useCallback(async () => {
    try {
      const data = await api<{ staff: StaffMember[]; invitations: Invitation[] }>(`${base}/staff`);
      setStaff(data.staff);
      setInvitations(data.invitations);
    } catch (err) {
      setError(err);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api<{ classes: { id: string; name: string }[] }>(`${base}/classes`)
      .then((data) => setClasses(data.classes))
      .catch(() => setClasses([]));
  }, [base]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const invite = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const phone = (form.elements.namedItem('phone') as HTMLInputElement).value;
    const role = (form.elements.namedItem('role') as HTMLSelectElement).value;
    void run(async () => {
      const { link } = await api<{ link: string }>(`${base}/staff/invitations`, {
        method: 'POST',
        body: { phone: toWesternDigits(phone), role },
      });
      setNewLink(absoluteUrl(link));
      form.reset();
    });
  };

  const grantUrl = (member: StaffMember, key: PermissionKey) =>
    `${base}/memberships/${member.membershipId}/permissions/${key}`;
  const scopeBody = (member: StaffMember, key: PermissionKey, classIds: string[]) =>
    member.role === 'assistant' && !WORKSPACE_ONLY.has(key) && classIds.length > 0
      ? { body: { classIds } }
      : {};

  const toggle = (member: StaffMember, key: PermissionKey, on: boolean) =>
    void run(() =>
      api(grantUrl(member, key), {
        method: on ? 'PUT' : 'DELETE',
        ...(on ? scopeBody(member, key, member.classIds) : {}),
      }),
    );

  /** A helper's class limit applies to each of their grants (none selected: whole workspace). */
  const toggleClass = (member: StaffMember, classId: string, on: boolean) => {
    const classIds = on
      ? [...member.classIds, classId]
      : member.classIds.filter((id) => id !== classId);
    void run(async () => {
      for (const key of member.granted) {
        if (WORKSPACE_ONLY.has(key)) continue;
        await api(grantUrl(member, key), { method: 'PUT', ...scopeBody(member, key, classIds) });
      }
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />

      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-1 font-semibold">{t('inviteTitle')}</h2>
        <p className="mb-4 text-sm text-muted">{t('inviteExplain')}</p>
        <form onSubmit={invite} noValidate>
          <Field label={t('phone')} name="phone" type="tel" inputMode="tel" dir="ltr" required />
          <Select
            label={t('role')}
            name="role"
            options={[
              { value: 'assistant', label: t('roles.assistant') },
              { value: 'class_teacher', label: t('roles.class_teacher') },
            ]}
          />
          <SubmitButton busy={busy}>{t('createLink')}</SubmitButton>
        </form>
        {newLink ? (
          <ShareLink url={newLink} message={t('whatsappText', { name: workspace.name })} />
        ) : null}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">{t('members')}</h2>
        {staff.length === 0 ? <p className="text-muted">{t('noStaff')}</p> : null}
        {staff.map((member) => (
          <article key={member.membershipId} className="rounded-2xl bg-surface p-5 shadow-sm">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold">{member.name}</p>
                <p className="text-sm text-muted">
                  {t(`roles.${member.role}`)} · <Ltr>{member.phoneE164}</Ltr>
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => api(`${base}/staff/${member.membershipId}`, { method: 'DELETE' }))
                }
                className="rounded-lg border px-3 py-1 text-sm text-red-700"
              >
                {t('remove')}
              </button>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">{t('permissionsTitle')}</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {PERMISSION_KEYS.filter((key) => isGrantable(member.role, key)).map((key) => {
                  const byDefault = member.defaults.includes(key);
                  const checked = byDefault || member.granted.includes(key);
                  return (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={checked}
                        disabled={busy || byDefault}
                        onChange={(event) => toggle(member, key, event.target.checked)}
                      />
                      {t(permissionLabelKey(key))}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {member.role === 'assistant' && classes.length > 0 ? (
              <fieldset className="mt-3">
                <legend className="mb-1 text-sm font-semibold">{t('classesTitle')}</legend>
                <p className="mb-2 text-xs text-muted">{t('classesExplain')}</p>
                <div className="grid gap-1 sm:grid-cols-2">
                  {classes.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="size-4"
                        checked={member.classIds.includes(c.id)}
                        disabled={busy || member.granted.length === 0}
                        onChange={(event) => toggleClass(member, c.id, event.target.checked)}
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
          </article>
        ))}
      </section>

      {invitations.some((i) => i.status === 'pending') ? (
        <section className="rounded-2xl bg-surface p-5 shadow-sm">
          <h2 className="mb-3 font-semibold">{t('pendingInvitations')}</h2>
          <ul className="flex flex-col gap-2">
            {invitations
              .filter((i) => i.status === 'pending')
              .map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>
                    <Ltr>{i.phoneE164}</Ltr> · {t(`roles.${i.role}`)} ·{' '}
                    {t('expires', {
                      date: format.dateTime(new Date(i.expiresAt), { dateStyle: 'medium' }),
                    })}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(() => api(`${base}/staff/invitations/${i.id}`, { method: 'DELETE' }))
                    }
                    className="underline"
                  >
                    {t('cancelInvitation')}
                  </button>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
