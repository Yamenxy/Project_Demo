'use client';

import { useEffect } from 'react';
import { registerServiceWorker } from '../lib/push';

/** Registers the service worker after the page has loaded. Renders nothing. */
export function ServiceWorker() {
  useEffect(() => {
    registerServiceWorker();
  }, []);
  return null;
}
