// Service worker (REQ-NOTIF-001, REQ-ATT-001). Deliberately small:
// - the attendance scanner reopens offline: its page and the workspace context it needs are kept
//   (network first, cache when offline), with the app's static files (cache first, hashed names);
// - nothing else is cached, so signed-in pages don't stay on shared phones; signing out clears it;
// - web push shows a generic notice and opens the link it carries, on this site only.
const CACHE = 'lms-offline-v1';

const SCANNER_PAGE = /^\/(ar|en)\/w\/[^/]+\/sessions\/[^/]+\/scan$/;
const WORKSPACE_CONTEXT = /^\/api\/v1\/w\/[^/]+\/context$/;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
  } else if (request.mode === 'navigate' && SCANNER_PAGE.test(url.pathname)) {
    event.respondWith(networkFirst(request));
  } else if (WORKSPACE_CONTEXT.test(url.pathname)) {
    // Only needed offline by the scanner, which asked for it while online.
    event.respondWith(networkFirst(request));
  }
});

self.addEventListener('push', (event) => {
  let message = { title: '', body: '', url: '/' };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // An empty or unreadable push still shows the generic notice.
  }
  event.waitUntil(
    self.registration.showNotification(message.title || 'LMS', {
      body: message.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: message.url },
      lang: 'ar',
      dir: 'auto',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  // Only paths on this site: a push can never send the user elsewhere.
  const path = typeof raw === 'string' && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
  const target = new URL(`/ar${path === '/' ? '' : path}`, self.location.origin).href;
  event.waitUntil(
    (async () => {
      for (const client of await self.clients.matchAll({ type: 'window' })) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
