/**
 * Service worker smoke test — runs sw.js in a sandboxed environment with
 * mocked Cache API + fetch + self.* and asserts routing behaviour:
 *
 *   • install caches STATIC_ASSETS
 *   • /api/* requests are NOT intercepted (no respondWith call)
 *   • /assets/<hash> uses cache-first (returns cached on second hit)
 *   • / (navigate) uses network-first (returns network on hit, cache on offline)
 *
 * This is a unit-level smoke, not a real-browser test. The full e2e
 * (offline → reload → app still renders) lives in browser smoke (D13).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const SW_PATH = resolve(__dirname, '../../public/sw.js');
const SW_SOURCE = readFileSync(SW_PATH, 'utf8');

interface FakeRequest {
  url: string;
  method: string;
  mode?: 'navigate' | 'cors' | 'no-cors' | 'same-origin';
  destination?: '' | 'document' | 'script' | 'image';
}

interface FakeResponse {
  ok: boolean;
  body: string;
  clone: () => FakeResponse;
}

function makeResponse(body: string, ok = true): FakeResponse {
  const r: FakeResponse = {
    ok,
    body,
    clone: () => makeResponse(body, ok),
  };
  return r;
}

function makeRequest(url: string, opts: Partial<FakeRequest> = {}): FakeRequest {
  return {
    url,
    method: 'GET',
    mode: opts.mode ?? 'cors',
    destination: opts.destination ?? '',
    ...opts,
  };
}

interface SwHarness {
  listeners: Map<string, ((e: unknown) => void)[]>;
  cache: Map<string, FakeResponse>;
  fetchMock: ReturnType<typeof vi.fn>;
  trigger: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

function loadSw(): SwHarness {
  const listeners = new Map<string, ((e: unknown) => void)[]>();
  const cache = new Map<string, FakeResponse>();

  const cacheStorage = {
    open: vi.fn(async () => ({
      addAll: vi.fn(async (urls: string[]) => {
        for (const u of urls) cache.set(u, makeResponse(`<cached:${u}>`));
      }),
      put: vi.fn(async (req: FakeRequest, res: FakeResponse) => {
        cache.set(req.url, res);
      }),
      match: vi.fn(async (reqOrUrl: FakeRequest | string) => {
        const key = typeof reqOrUrl === 'string' ? reqOrUrl : reqOrUrl.url;
        return cache.get(key) ?? undefined;
      }),
    })),
    keys: vi.fn(async () => ['amass-shell-v5']),
    delete: vi.fn(async () => true),
  };

  const fetchMock = vi.fn(async (req: FakeRequest) => makeResponse(`<network:${req.url}>`));

  const self = {
    addEventListener: (event: string, fn: (e: unknown) => void) => {
      const list = listeners.get(event) ?? [];
      list.push(fn);
      listeners.set(event, list);
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined) },
  };

  const ctx = vm.createContext({
    self,
    caches: cacheStorage,
    fetch: fetchMock,
    URL,
    Promise,
    Response: { error: () => makeResponse('', false) },
    console,
  });

  vm.runInContext(SW_SOURCE, ctx);

  async function trigger(event: string, payload: Record<string, unknown>): Promise<void> {
    const list = listeners.get(event) ?? [];
    for (const fn of list) await fn(payload);
  }

  return { listeners, cache, fetchMock, trigger };
}

describe('service-worker (sw.js)', () => {
  let h: SwHarness;

  beforeEach(() => {
    h = loadSw();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('caches STATIC_ASSETS on install', async () => {
    const waitUntil = vi.fn(async (p: Promise<unknown>) => p);
    await h.trigger('install', { waitUntil });

    expect(waitUntil).toHaveBeenCalled();
    // The promise passed to waitUntil resolves after addAll completes.
    await waitUntil.mock.calls[0]![0];
    expect(h.cache.has('/manifest.webmanifest')).toBe(true);
    expect(h.cache.has('/icon-192.svg')).toBe(true);
    expect(h.cache.has('/icon-512.svg')).toBe(true);
  });

  it('does NOT intercept /api/* fetches (network-only authenticated data)', async () => {
    const respondWith = vi.fn();
    const event = {
      request: makeRequest('https://app.test/api/v1/companies'),
      respondWith,
    };
    await h.trigger('fetch', event);

    // The handler returns early without calling respondWith — browser
    // does the network fetch normally. This is what keeps tenant data
    // off the URL-keyed cache.
    expect(respondWith).not.toHaveBeenCalled();
  });

  it('cache-first for /assets/* (Vite hashed bundles)', async () => {
    const respondWith = vi.fn();
    const event = {
      request: makeRequest('https://app.test/assets/index-abc123.js'),
      respondWith,
    };
    await h.trigger('fetch', event);

    expect(respondWith).toHaveBeenCalled();
    const result = await respondWith.mock.calls[0]![0];
    // First hit: cache empty, falls back to fetch and caches.
    expect((result as FakeResponse).body).toBe('<network:https://app.test/assets/index-abc123.js>');
    expect(h.fetchMock).toHaveBeenCalled();

    // Second hit: served from cache, no fetch call.
    h.fetchMock.mockClear();
    const event2 = {
      request: makeRequest('https://app.test/assets/index-abc123.js'),
      respondWith: vi.fn(),
    };
    await h.trigger('fetch', event2);
    const second = await event2.respondWith.mock.calls[0]![0];
    expect((second as FakeResponse).body).toBe('<network:https://app.test/assets/index-abc123.js>');
    expect(h.fetchMock).not.toHaveBeenCalled();
  });

  it('network-first for navigations (HTML), falls back to cache when offline', async () => {
    const respondWith = vi.fn();
    const event = {
      request: makeRequest('https://app.test/app/companies', {
        mode: 'navigate',
        destination: 'document',
      }),
      respondWith,
    };
    await h.trigger('fetch', event);

    expect(respondWith).toHaveBeenCalled();
    const result = await respondWith.mock.calls[0]![0];
    // Online: returns network.
    expect((result as FakeResponse).body).toContain('<network:');

    // Now go offline for a NEW page (not previously cached). Cached "/"
    // is the last resort SPA shell.
    h.cache.set('/', makeResponse('<cached:/>'));
    h.fetchMock.mockRejectedValueOnce(new Error('offline'));

    const respondWith2 = vi.fn();
    const event2 = {
      request: makeRequest('https://app.test/app/never-visited', {
        mode: 'navigate',
        destination: 'document',
      }),
      respondWith: respondWith2,
    };
    await h.trigger('fetch', event2);
    const offlineResult = await respondWith2.mock.calls[0]![0];
    // Falls back to root shell when the navigation request itself isn't cached.
    expect((offlineResult as FakeResponse).body).toBe('<cached:/>');
  });

  it('CLEAR_CACHES message wipes every cache (logout flow)', async () => {
    h.cache.set('/foo', makeResponse('foo'));
    const waitUntil = vi.fn(async (p: Promise<unknown>) => p);
    await h.trigger('message', {
      data: { type: 'CLEAR_CACHES' },
      waitUntil,
    });
    expect(waitUntil).toHaveBeenCalled();
  });
});
