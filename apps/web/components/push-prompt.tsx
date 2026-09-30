'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { canOfferPush, enablePush, pushKey } from '../lib/push';

const DISMISSED = 'lms.push.dismissed';

function dismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === '1';
  } catch {
    return false;
  }
}

/**
 * Offers push notifications (REQ-NOTIF-001). Shown only where the user just did something that
 * notifications follow up on (never on first load), and only if the browser can still be asked.
 * The browser's permission prompt appears only when the button is pressed.
 */
export function PushPrompt() {
  const t = useTranslations('push');
  const [key, setKey] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'busy' | 'on' | 'hidden'>('idle');

  useEffect(() => {
    if (!canOfferPush() || dismissed()) return;
    pushKey()
      .then(setKey)
      .catch(() => undefined);
  }, []);

  if (!key || state === 'hidden') return null;
  if (state === 'on') {
    return (
      <p role="status" className="rounded-xl bg-surface p-3 text-sm shadow-sm">
        {t('on')}
      </p>
    );
  }

  const enable = () => {
    setState('busy');
    enablePush(key)
      .then((on) => setState(on ? 'on' : 'hidden'))
      .catch(() => setState('hidden'));
  };
  const later = () => {
    try {
      localStorage.setItem(DISMISSED, '1');
    } catch {
      // Private mode: it just shows again next time.
    }
    setState('hidden');
  };

  return (
    <section className="flex flex-col gap-2 rounded-xl bg-surface p-3 text-sm shadow-sm">
      <p>{t('offer')}</p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={state === 'busy'}
          onClick={enable}
          className="rounded-lg bg-brand px-3 py-1 text-brand-contrast"
        >
          {t('enable')}
        </button>
        <button type="button" onClick={later} className="rounded-lg border px-3 py-1">
          {t('later')}
        </button>
      </div>
    </section>
  );
}
