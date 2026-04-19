// Minimal PWA service worker — installable shell + offline page.
// Runtime caching policy is intentionally conservative: never cache /api/* (would
// hide multi-tenant boundaries and stale data); only cache the app shell so the
// page can boot offline. Future: precache static assets via vite-plugin-pwa.

const CACHE = 'amass-shell-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.svg', '/icon-512.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Never intercept API calls — they MUST go to the network so tenant context
  // and auth tokens are honoured.
  if (url.pathname.startsWith('/api/')) return;
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request).then((r) => r ?? caches.match('/'))),
  );
});
