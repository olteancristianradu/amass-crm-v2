// AMASS-CRM service worker — v3 (offline-capable mobile shell + selective API cache).
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
//   - GET /api/v1/companies + /api/v1/contacts (list + detail) →
//     STALE-WHILE-REVALIDATE so offline mobile shows last-seen data with a
//     background refresh on reconnect.
//   - Everything else on /api/* → network-only (auth, mutations, sensitive
//     reads).
//
// Cross-tenant safety: cache keys are URL-only. The cache is shared across
// users on the same browser profile. We mitigate by:
//   1. Clearing caches on logout (FE responsibility — already wired in
//      AppShell.handleLogout via queryClient.clear() + caches.delete()).
//   2. Limiting API caching to non-sensitive endpoints.
//   3. Always revalidating in the background.

// Bump on every breaking change so old clients purge on activate.
// v4: tenant-removed login + 3 themes shipped → ensure stale HTML pointing
// at deleted bundle hashes (from the v3 build) gets evicted.
const CACHE = 'amass-shell-v4';
const STATIC_ASSETS = ['/manifest.webmanifest', '/icon-192.svg', '/icon-512.svg'];

// API paths we DO want to cache for offline UX. Keep this list narrow.
const CACHEABLE_API_PREFIXES = ['/api/v1/companies', '/api/v1/contacts'];

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

  // 1. API — only cache the explicit prefixes; everything else network-only.
  if (url.pathname.startsWith('/api/')) {
    if (CACHEABLE_API_PREFIXES.some((p) => url.pathname.startsWith(p))) {
      e.respondWith(staleWhileRevalidate(req));
    }
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

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fetchPromise = fetch(request)
    .then((fresh) => {
      if (fresh.ok) cache.put(request, fresh.clone());
      return fresh;
    })
    .catch(() => null);
  // If we have a cached copy, serve it immediately and update in the
  // background. Otherwise wait for the network.
  return cached ?? (await fetchPromise) ?? Response.error();
}
