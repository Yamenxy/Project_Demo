'use client';

import { toWesternDigits } from '@lms/shared';
import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { useRouter } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { ErrorMessage, Field, FormCard, SubmitButton } from '../form';

function useSubmit() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

/** Where to go after signing in: a same-site path only, never another site (open redirect). */
function useNext(fallback: string): string {
  const next = useSearchParams().get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
}

function value(form: HTMLFormElement, name: string): string {
  const field = form.elements.namedItem(name);
  return field instanceof HTMLInputElement ? field.value : '';
}

export function RegisterForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { busy, error, run } = useSubmit();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      await api('/auth/register', {
        method: 'POST',
        body: {
          nameAr: value(form, 'name'),
          phone: toWesternDigits(value(form, 'phone')),
          password: value(form, 'password'),
          ...(value(form, 'dateOfBirth') ? { dateOfBirth: value(form, 'dateOfBirth') } : {}),
        },
      });
      router.push('/verify-phone');
    });
  };

  return (
    <FormCard title={t('registerTitle')}>
      <form onSubmit={submit} noValidate>
        <ErrorMessage error={error} />
        <Field label={t('name')} name="name" autoComplete="name" required />
        <Field
          label={t('phone')}
          name="phone"
          type="tel"
          inputMode="tel"
          dir="ltr"
          autoComplete="tel"
          hint={t('phoneHint')}
          required
        />
        <Field
          label={t('password')}
          name="password"
          type="password"
          dir="ltr"
          autoComplete="new-password"
          hint={t('passwordHint')}
          required
        />
        <Field
          label={t('dateOfBirth')}
          name="dateOfBirth"
          type="date"
          dir="ltr"
          autoComplete="bday"
          hint={t('dateOfBirthHint')}
        />
        <SubmitButton busy={busy}>{t('registerSubmit')}</SubmitButton>
      </form>
    </FormCard>
  );
}

export function VerifyPhoneForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const { busy, error, run } = useSubmit();
  const [sent, setSent] = useState(false);

  const send = () =>
    void run(async () => {
      await api('/auth/phone/send-code', { method: 'POST' });
      setSent(true);
    });

  const verify = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      await api('/auth/phone/verify', {
        method: 'POST',
        body: { code: toWesternDigits(value(form, 'code')) },
      });
      router.push('/account');
    });
  };

  return (
    <FormCard title={t('verifyTitle')}>
      <ErrorMessage error={error} />
      <p className="mb-4 text-muted">{t('verifyExplain')}</p>
      <button
        type="button"
        onClick={send}
        disabled={busy}
        className="mb-6 w-full rounded-lg border px-4 py-3 font-semibold"
      >
        {sent ? t('resendCode') : t('sendCode')}
      </button>
      {sent ? (
        <form onSubmit={verify} noValidate>
          <p role="status" className="mb-4 text-sm text-brand">
            {t('codeSent')}
          </p>
          <Field
            label={t('code')}
            name="code"
            inputMode="numeric"
            dir="ltr"
            autoComplete="one-time-code"
            required
          />
          <SubmitButton busy={busy}>{t('verifySubmit')}</SubmitButton>
        </form>
      ) : null}
    </FormCard>
  );
}

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const next = useNext('/account');
  const { busy, error, run } = useSubmit();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const remember = form.elements.namedItem('remember');
    void run(async () => {
      const result = await api<{ secondFactorRequired: boolean }>('/auth/login', {
        method: 'POST',
        body: {
          identifier: toWesternDigits(value(form, 'identifier')),
          password: value(form, 'password'),
          rememberMe: remember instanceof HTMLInputElement && remember.checked,
        },
      });
      router.push(
        result.secondFactorRequired ? `/two-factor?next=${encodeURIComponent(next)}` : next,
      );
    });
  };

  return (
    <FormCard title={t('loginTitle')}>
      <form onSubmit={submit} noValidate>
        <ErrorMessage error={error} />
        <Field
          label={t('identifier')}
          name="identifier"
          inputMode="tel"
          dir="ltr"
          autoComplete="username"
          required
        />
        <Field
          label={t('password')}
          name="password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          required
        />
        <label className="mb-6 flex items-center gap-2 text-sm">
          <input type="checkbox" name="remember" className="size-4" />
          {t('rememberMe')}
        </label>
        <SubmitButton busy={busy}>{t('loginSubmit')}</SubmitButton>
      </form>
    </FormCard>
  );
}

export function TwoFactorForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const next = useNext('/account');
  const { busy, error, run } = useSubmit();

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    void run(async () => {
      await api('/auth/2fa/verify', {
        method: 'POST',
        body: { code: toWesternDigits(value(form, 'code')) },
      });
      router.push(next);
    });
  };

  return (
    <FormCard title={t('twoFactorTitle')}>
      <form onSubmit={submit} noValidate>
        <ErrorMessage error={error} />
        <p className="mb-4 text-muted">{t('twoFactorExplain')}</p>
        <Field
          label={t('code')}
          name="code"
          dir="ltr"
          autoComplete="one-time-code"
          hint={t('recoveryHint')}
          required
        />
        <SubmitButton busy={busy}>{t('verifySubmit')}</SubmitButton>
      </form>
    </FormCard>
  );
}
