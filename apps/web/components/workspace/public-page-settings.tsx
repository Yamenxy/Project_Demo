'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../lib/api';
import { ErrorMessage, Field, SubmitButton } from '../form';
import { absoluteUrl, ShareLink } from './share-link';

interface Settings {
  slug: string;
  enabled: boolean;
  bio: string | null;
  subjects: string[];
}

/** The owner edits the public teacher page (REQ-CONTENT-003). */
export function PublicPageSettings({ workspaceId, name }: { workspaceId: string; name: string }) {
  const t = useTranslations('publicPage');
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const url = `/w/${workspaceId}/public-page`;

  useEffect(() => {
    api<Settings>(url).then(setSettings).catch(setError);
  }, [url]);

  const save = (change: Partial<{ enabled: boolean; bio: string | null; subjects: string[] }>) => {
    setBusy(true);
    setError(null);
    setSaved(false);
    api<Settings>(url, { method: 'POST', body: change })
      .then((next) => {
        setSettings(next);
        setSaved(true);
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const bio = (form.elements.namedItem('bio') as HTMLTextAreaElement).value;
    const subjects = (form.elements.namedItem('subjects') as HTMLInputElement).value
      .split(/[,،]/)
      .map((s) => s.trim())
      .filter(Boolean);
    save({ bio: bio.trim() || null, subjects });
  };

  if (!settings) return <ErrorMessage error={error} />;

  return (
    <section className="rounded-2xl bg-surface p-6 shadow-sm">
      <h2 className="mb-1 font-semibold">{t('title')}</h2>
      <p className="mb-3 text-sm text-muted">{t('explain')}</p>
      <ErrorMessage error={error} />
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4"
          checked={settings.enabled}
          disabled={busy}
          onChange={(event) => save({ enabled: event.target.checked })}
        />
        {t('enabled')}
      </label>
      {settings.enabled ? (
        <ShareLink url={absoluteUrl(`/t/${settings.slug}`)} message={t('shareMessage', { name })} />
      ) : null}
      <form onSubmit={submit} noValidate className="mt-4">
        <Field
          label={t('subjects')}
          name="subjects"
          defaultValue={settings.subjects.join('، ')}
          hint={t('subjectsHint')}
        />
        <div className="mb-4 flex flex-col gap-1">
          <label htmlFor="public-bio" className="text-sm font-semibold">
            {t('bio')}
          </label>
          <textarea
            id="public-bio"
            name="bio"
            rows={4}
            maxLength={1000}
            defaultValue={settings.bio ?? ''}
            className="rounded-lg border border-gray-300 bg-white px-3 py-3 text-base focus:border-brand focus:outline-none"
          />
          <p className="text-sm text-muted">{t('bioHint')}</p>
        </div>
        <SubmitButton busy={busy}>{t('save')}</SubmitButton>
        {saved ? (
          <p role="status" className="mt-2 text-sm text-brand">
            {t('saved')}
          </p>
        ) : null}
      </form>
    </section>
  );
}
