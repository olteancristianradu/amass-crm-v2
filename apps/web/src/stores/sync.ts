import { create } from 'zustand';

/**
 * In-memory store for the Socket.IO `/sync` connection state.
 *
 * Kept deliberately tiny:
 *  - `connected` toggles when the socket connects/disconnects; the topbar
 *    "Live" badge reads it via `useSyncStatus`.
 *  - `lastEventAt` is updated whenever a sync event is received, used by
 *    debug tooling / future presence indicators. Plain epoch ms keeps the
 *    serialization story trivial.
 *
 * Not persisted — connection state is meaningless across reloads (a fresh
 * tab starts disconnected and re-handshakes from scratch).
 */
interface SyncState {
  connected: boolean;
  lastEventAt: number | null;
  setConnected: (v: boolean) => void;
  markEvent: () => void;
}

export const useSyncStore = create<SyncState>((set) => ({
  connected: false,
  lastEventAt: null,
  setConnected: (v) => set({ connected: v }),
  markEvent: () => set({ lastEventAt: Date.now() }),
}));
