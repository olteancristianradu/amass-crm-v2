import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/stores/toasts';
import { useAuthStore } from '@/stores/auth';
import type { CursorPage, Reminder } from '@/lib/types';

const POLL_INTERVAL_MS = 60_000; // 60 seconds

/**
 * Polls GET /reminders/me?status=FIRED every 60 seconds.
 * Shows a toast for each newly FIRED reminder since the last poll.
 * Mount once inside AppShell.
 */
export function useReminderPoller(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated());
  const seenIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isAuthenticated) return;

    const poll = async (): Promise<void> => {
      try {
        const result = await api.get<CursorPage<Reminder>>('/reminders/me', {
          status: 'FIRED',
          limit: 10,
        });
        for (const reminder of result.data) {
          if (!seenIds.current.has(reminder.id)) {
            seenIds.current.add(reminder.id);
            toast(`Reminder: ${reminder.title}`, reminder.body ?? undefined);
          }
        }
      } catch {
        // Silently ignore poll errors — network blip shouldn't break anything
      }
    };

    void poll();
    const id = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isAuthenticated]);
}
