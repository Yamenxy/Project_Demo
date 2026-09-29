'use client';

import { useTranslations } from 'next-intl';

/** A link to hand to someone: copy it, or send it on WhatsApp with a short message (NOTIF-002). */
export function ShareLink({ url, message }: { url: string; message: string }) {
  const t = useTranslations('share');
  return (
    <div className="mt-4 rounded-lg bg-green-50 p-3">
      <p className="mb-2 text-sm">{t('ready')}</p>
      <p className="mb-3 break-all font-mono text-xs" dir="ltr">
        {url}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(url)}
          className="rounded-lg border px-3 py-2 text-sm"
        >
          {t('copy')}
        </button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(`${message} ${url}`)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-lg bg-green-600 px-3 py-2 text-sm text-white"
        >
          {t('whatsApp')}
        </a>
      </div>
    </div>
  );
}

/** Absolute URL for an app path, in the current language. */
export function absoluteUrl(path: string): string {
  return `${window.location.origin}/${document.documentElement.lang}${path}`;
}
