import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import { toast } from '@/stores/toasts';
import { useAuthStore } from '@/stores/auth';

let socket: Socket | null = null;

/**
 * Connects to the Socket.IO server and listens for `reminder:fired` events.
 * Falls back gracefully if the connection fails — this is UI chrome, not
 * a critical path.
 *
 * A module-level socket instance is reused across React strict-mode double
 * mounts. It is torn down when the last authenticated consumer unmounts.
 */
export function useReminderPoller(): void {
  const accessToken = useAuthStore((s) => s.accessToken);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());

  useEffect(() => {
    if (!isAuthenticated || !accessToken) return;

    if (!socket) {
      socket = io({ path: '/ws', auth: { token: accessToken }, transports: ['websocket'] });
    }

    const handler = (data: { id: string; title: string; body: string | null }) => {
      toast(`Reminder: ${data.title}`, data.body ?? undefined);
    };

    socket.on('reminder:fired', handler);

    return () => {
      socket?.off('reminder:fired', handler);
    };
  }, [isAuthenticated, accessToken]);

  // Disconnect on logout
  useEffect(() => {
    if (!isAuthenticated && socket) {
      socket.disconnect();
      socket = null;
    }
  }, [isAuthenticated]);
}
