import { api } from './api';

/** The offline cache the service worker keeps (public/sw.js). */
const OFFLINE_CACHE = 'lms-offline-v1';

/** Registers the service worker, in production builds only (dev servers change files live). */
export function registerServiceWorker(): void {
  if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
}

/**
 * Before signing out: forgets what the service worker kept for offline use, and stops push to
 * this browser (on the server too, while the session is still valid).
 */
export async function clearDeviceData(): Promise<void> {
  try {
    if ('caches' in window) await caches.delete(OFFLINE_CACHE);
    if (!('serviceWorker' in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (subscription) {
      await api('/push/subscriptions/remove', {
        method: 'POST',
        body: { endpoint: subscription.endpoint },
      }).catch(() => undefined);
      await subscription.unsubscribe();
    }
  } catch {
    // Best effort: signing out must never fail because of this.
  }
}

/** Push can be offered: the browser supports it and hasn't been asked yet. */
export function canOfferPush(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    Notification.permission === 'default'
  );
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** The server's VAPID key, or null when push isn't set up on this server. */
export async function pushKey(): Promise<string | null> {
  return (await api<{ publicKey: string | null }>('/push/key')).publicKey;
}

/**
 * Asks for permission (only ever from a button the user pressed) and saves the subscription.
 * Returns whether notifications are now on.
 */
export async function enablePush(publicKey: string): Promise<boolean> {
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(publicKey),
    }));
  const json = subscription.toJSON();
  await api('/push/subscriptions', {
    method: 'POST',
    body: { endpoint: json.endpoint, keys: json.keys },
  });
  return true;
}
