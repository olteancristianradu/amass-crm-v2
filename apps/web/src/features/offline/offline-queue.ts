/**
 * B1-PR5 — IndexedDB-backed offline write buffer.
 *
 * Why IndexedDB and not localStorage?
 *   - localStorage is synchronous and ~5MB. A queue of pending PATCH bodies
 *     blows that easily, and the sync write blocks the main thread.
 *   - IndexedDB is async, durable across reloads, and survives tab restarts.
 *     `idb` wraps the verbose IDBRequest API with a Promise surface.
 *
 * Data model: one store, `mutations`, keyed by auto-incrementing `id`.
 * Each row captures everything needed to re-execute the request later:
 *   - method, url (absolute path including `/api/v1` prefix)
 *   - body (serialised JSON — we re-stringify at replay time)
 *   - headers (optional extras; auth header is re-injected by api.ts at
 *     replay since the access token may have refreshed)
 *   - createdAt, attempts, lastError (for exponential backoff + indicator)
 *
 * Scope: single device-wide queue. PR5 does NOT partition per-user/per-tenant
 * because we wipe IndexedDB on logout (planned in PR6 alongside per-user
 * scoping). Until then, the only consumer of this queue is the authed shell
 * which is a single-user session at a time.
 *
 * Conflict policy: last-write-wins. No CRDT. PR5 is intentionally simple;
 * if two tabs queue the same PATCH while offline, the second replay
 * overwrites the first — which is the same behaviour we get online today.
 */
import { openDB, type IDBPDatabase } from 'idb';

const DB_NAME = 'amass-offline-v1';
const STORE = 'mutations';
const DB_VERSION = 1;

export type HttpMethod = 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export interface QueuedMutation {
  /** IndexedDB-assigned monotonically increasing primary key. */
  id: number;
  method: HttpMethod;
  /** Absolute API path including `/api/v1` prefix (so replay doesn't double-prefix). */
  url: string;
  /** Body as parsed JSON (or undefined for DELETE). */
  body: unknown;
  /** Extra headers requested at enqueue time. Auth header is NOT stored here — re-injected at replay. */
  headers?: Record<string, string>;
  /** Epoch ms when the mutation was first enqueued. */
  createdAt: number;
  /** Replay attempts counter — drives exponential backoff in the hook. */
  attempts: number;
  /** Last replay error message (truncated) — surfaced in the indicator tooltip. */
  lastError?: string;
}

type DraftMutation = Omit<QueuedMutation, 'id' | 'createdAt' | 'attempts' | 'lastError'>;

let dbPromise: Promise<IDBPDatabase> | null = null;

/**
 * Lazy DB handle. We don't open at module import because:
 *  1) SSR / test boot might not have `indexedDB` polyfilled yet.
 *  2) Most sessions stay online and never need the queue — opening a DB
 *     creates a connection that holds the autovacuum slot open.
 */
function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Append a mutation to the queue. Returns the auto-incremented id so the
 * caller (api.ts) can hand it back to the React Query mutation as
 * `{ queued: true, queuedId }`.
 *
 * Two concurrent enqueues never collide — IndexedDB serialises writes
 * within a transaction and the `autoIncrement` keyspace is monotonic.
 */
export async function enqueue(draft: DraftMutation): Promise<number> {
  const db = await getDb();
  const row = {
    ...draft,
    createdAt: Date.now(),
    attempts: 0,
  } satisfies Omit<QueuedMutation, 'id' | 'lastError'>;
  const id = (await db.add(STORE, row)) as number;
  return id;
}

/** Remove a mutation by id — called after a successful replay. */
export async function dequeue(id: number): Promise<void> {
  const db = await getDb();
  await db.delete(STORE, id);
}

/**
 * Read every queued mutation in insertion order.
 *
 * `idb.getAll()` returns rows in key-ascending order, which matches
 * insertion order because the keyPath autoincrements — so this is FIFO
 * by construction. Callers (replay loop, indicator badge) can iterate
 * without an explicit sort.
 */
export async function peekAll(): Promise<QueuedMutation[]> {
  const db = await getDb();
  return (await db.getAll(STORE)) as QueuedMutation[];
}

/** Bump attempt counter + record the latest error. Used by the replay loop. */
export async function incrementAttempt(id: number, error: string): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(STORE, 'readwrite');
  const row = (await tx.store.get(id)) as QueuedMutation | undefined;
  if (!row) {
    await tx.done;
    return;
  }
  row.attempts += 1;
  // Cap error length — IndexedDB has no string limit but a runaway stack
  // trace bloats the row and the tooltip preview.
  row.lastError = error.slice(0, 500);
  await tx.store.put(row);
  await tx.done;
}

/**
 * Test-only helper. Resets the module-level promise and clears the store
 * between tests so each spec sees a fresh queue. NOT exported through the
 * barrel — call directly from spec files.
 */
export async function _resetForTests(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  // fake-indexeddb honours deleteDatabase synchronously enough for our needs.
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

export const offlineQueue = {
  enqueue,
  dequeue,
  peekAll,
  incrementAttempt,
};
