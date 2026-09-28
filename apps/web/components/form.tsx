'use client';

import { useTranslations } from 'next-intl';
import type { InputHTMLAttributes, ReactNode } from 'react';
import { useId } from 'react';
import { ApiError } from '../lib/api';

/** A page-level card for short forms on a phone screen. */
export function FormCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="rounded-2xl bg-surface p-6 shadow-sm">
        <h1 className="mb-6 text-xl font-semibold">{title}</h1>
        {children}
      </div>
    </main>
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
}

/**
 * A labelled input. Phone numbers, codes and passwords are typed left-to-right even in Arabic
 * (`dir="ltr"` is passed by the caller).
 */
export function Field({ label, hint, ...input }: FieldProps) {
  const id = useId();
  return (
    <div className="mb-4 flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        className="rounded-lg border border-gray-300 bg-white px-3 py-3 text-base focus:border-brand focus:outline-none"
        {...input}
      />
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full rounded-lg bg-brand px-4 py-3 font-semibold text-brand-contrast disabled:opacity-60"
    >
      {children}
    </button>
  );
}

/** Shows an API error as translated text; unknown codes fall back to a generic message. */
export function ErrorMessage({ error }: { error: unknown }) {
  const t = useTranslations('errors');
  if (!error) return null;
  const code = error instanceof ApiError ? error.code : 'generic';
  return (
    <p role="alert" className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {t.has(code) ? t(code) : t('generic')}
    </p>
  );
}
