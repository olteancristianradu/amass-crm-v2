import * as React from 'react';
import { useSyncSocket } from './SyncProvider';
import { useAuthStore } from '@/stores/auth';

/**
 * B1-PR4 — Presence hook for detail pages.
 *
 * Lifecycle:
 *  - On mount (and whenever `resourceId` changes): emits `presence:enter`
 *    to the `/sync` namespace so the server records this user in the
 *    resource's presence set and broadcasts `presence:joined` to every
 *    other socket in the tenant room.
 *  - While mounted: subscribes to `presence:joined` and `presence:left`
 *    events, filtered to the current (resourceType, resourceId), and
 *    maintains a local Set of viewer userIds (excluding the own user).
 *  - Heartbeat: re-emits `presence:enter` every 30s so the server-side
 *    60s TTL never crosses the edge while the tab is open.
 *  - On unmount (or when resourceId changes): emits `presence:leave` so
 *    other viewers see "user left" immediately instead of waiting for
 *    the TTL to expire.
 *
 * Returns:
 *   { viewerUserIds, count }   viewer list with self filtered out, plus
 *                              its length as a convenience for the badge.
 *
 * Guards:
 *  - When `resourceId` is undefined (still loading the page data) → no-op.
 *  - When the socket is null (logged out, or not yet connected) → no-op.
 *    The next render that has both will run the effect.
 */
export type PresenceResourceType = 'company' | 'contact' | 'client' | 'deal';

const HEARTBEAT_INTERVAL_MS = 30_000;

interface PresenceEvent {
  resourceType: string;
  resourceId: string;
  userId: string;
}

export interface UsePresenceResult {
  viewerUserIds: string[];
  count: number;
}

export function usePresence(
  resourceType: PresenceResourceType,
  resourceId: string | undefined,
): UsePresenceResult {
  const socket = useSyncSocket();
  const ownUserId = useAuthStore((s) => s.user?.id ?? null);
  // State keyed by `${resourceType}|${resourceId}` so navigating between
  // resources can't leak stale viewers — the selector below filters to the
  // current key and the old buckets simply go un-rendered until GC reclaims
  // them on the next event. This avoids calling setState synchronously from
  // the effect body just to wipe the prior page's viewers.
  const [viewersByKey, setViewersByKey] = React.useState<Map<string, Set<string>>>(
    () => new Map(),
  );
  const currentKey = resourceId ? `${resourceType}|${resourceId}` : null;

  React.useEffect(() => {
    if (!socket || !resourceId) {
      return;
    }
    const key = `${resourceType}|${resourceId}`;

    function announceEnter(): void {
      socket?.emit('presence:enter', { resourceType, resourceId });
    }

    function onJoined(evt: PresenceEvent): void {
      if (evt.resourceType !== resourceType || evt.resourceId !== resourceId) return;
      setViewersByKey((prev) => {
        const set = prev.get(key) ?? new Set<string>();
        if (set.has(evt.userId)) return prev;
        const next = new Map(prev);
        const updated = new Set(set);
        updated.add(evt.userId);
        next.set(key, updated);
        return next;
      });
    }

    function onLeft(evt: PresenceEvent): void {
      if (evt.resourceType !== resourceType || evt.resourceId !== resourceId) return;
      setViewersByKey((prev) => {
        const set = prev.get(key);
        if (!set || !set.has(evt.userId)) return prev;
        const next = new Map(prev);
        const updated = new Set(set);
        updated.delete(evt.userId);
        next.set(key, updated);
        return next;
      });
    }

    socket.on('presence:joined', onJoined);
    socket.on('presence:left', onLeft);

    // Initial enter — the server will broadcast our own `presence:joined`
    // back to us as well, but we filter self out of the viewer list below
    // so there's no double-count.
    announceEnter();
    const heartbeat = window.setInterval(announceEnter, HEARTBEAT_INTERVAL_MS);

    return () => {
      window.clearInterval(heartbeat);
      socket.emit('presence:leave', { resourceType, resourceId });
      socket.off('presence:joined', onJoined);
      socket.off('presence:left', onLeft);
    };
  }, [socket, resourceType, resourceId]);

  // Filter own userId so the badge never counts the current user as
  // a "remote viewer" of their own page.
  const viewerUserIds = React.useMemo(() => {
    if (!currentKey) return [];
    const set = viewersByKey.get(currentKey);
    if (!set || set.size === 0) return [];
    const out: string[] = [];
    for (const id of set) {
      if (id !== ownUserId) out.push(id);
    }
    return out;
  }, [viewersByKey, currentKey, ownUserId]);

  return { viewerUserIds, count: viewerUserIds.length };
}
