import { useSyncStore } from '@/stores/sync';

/**
 * Read-only view onto the Socket.IO sync connection state.
 *
 * Consumed by the topbar "Live" badge in AppShell — green dot when
 * `connected`, grey while reconnecting. `lastEventAt` is exposed for
 * debugging / future presence widgets.
 */
export interface SyncStatus {
  connected: boolean;
  lastEventAt: number | null;
}

export function useSyncStatus(): SyncStatus {
  const connected = useSyncStore((s) => s.connected);
  const lastEventAt = useSyncStore((s) => s.lastEventAt);
  return { connected, lastEventAt };
}
