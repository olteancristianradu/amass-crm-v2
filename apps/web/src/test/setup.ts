import '@testing-library/jest-dom/vitest';

/**
 * Node 25+ ships an experimental native `localStorage` that activates
 * when `--localstorage-file=…` is set; without a valid path it stays
 * present but its methods are undefined. That broken native object
 * shadows jsdom's working implementation, so any test that touches
 * `localStorage.setItem` (or zustand persist's storage backend) trips
 * `TypeError: storage.setItem is not a function`.
 *
 * Fix: replace the global with an in-memory shim that mimics the Web
 * Storage API. Tests don't share state across files (Vitest isolates
 * each via worker pool) so a per-process Map is safe.
 */
if (typeof globalThis.localStorage !== 'object' || typeof globalThis.localStorage.setItem !== 'function') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  } satisfies Storage;
}
if (typeof globalThis.sessionStorage !== 'object' || typeof globalThis.sessionStorage.setItem !== 'function') {
  const store = new Map<string, string>();
  globalThis.sessionStorage = {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  } satisfies Storage;
}
