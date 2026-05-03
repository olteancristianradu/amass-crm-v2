// AMASS-CRM service worker — offline-capable mobile shell. Authenticated API
// responses are intentionally network-only.
//
// Bump CACHE on any breaking change so old clients purge on activate. Past
// regression: when a deploy changed hashed filenames, the SW served a stale
// HTML pointing at missing chunks → blank page Ctrl+F5 couldn't clear. The
// fix below avoids that:
//   - HTML ("/" + Vite-generated index.html) → NETWORK-FIRST, so the latest
//     HTML always wins. Cache is fallback ONLY when the network is down.
//   - Hashed Vite assets ("/assets/*.[hash].js|.css") → CACHE-FIRST. They are
//     content-addressed; if the hash matches, the content matches — cache
//     forever, never stale.
//   - Every /api/* request → network-only. API responses are authenticated
//     tenant data and must not be cached under URL-only service-worker keys.
//
// Bump on every breaking change so old clients purge on activate.
// v4: tenant-removed login + 3 themes shipped → ensure stale HTML pointing
// at deleted bundle hashes (from the v3 build) gets evicted.
// v5: remove all authenticated API response caching.
const CACHE = 'amass-shell-v5';
const STATIC_ASSETS = ['/manifest.webmanifest', '/icon-192.svg', '/icon-512.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    Promise.all([
      caches.keys().then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return; // never cache mutations

  const url = new URL(req.url);

  // 1. API — network-only. Do not cache tenant/user data in a URL-keyed SW cache.
  if (url.pathname.startsWith('/api/')) {
    return;
  }

  // 2. Vite hashed assets (cache-first, immutable).
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // 3. Everything else (HTML navigations, manifest, icons): network-first.
  if (req.mode === 'navigate' || req.destination === 'document') {
    e.respondWith(networkFirst(req));
    return;
  }

  // 4. Static stuff (icons, manifest) — cache-first with network fallback.
  e.respondWith(cacheFirst(req));
});

// Allow the FE to wipe caches on logout via postMessage.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))),
    );
  }
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    // Last resort: serve cached "/" so SPA can render its offline screen.
    const root = await cache.match('/');
    return root ?? Response.error();
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const fresh = await fetch(request);
    if (fresh.ok) cache.put(request, fresh.clone());
    return fresh;
  } catch {
    return Response.error();
  }
}
