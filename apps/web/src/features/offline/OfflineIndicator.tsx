import * as React from 'react';
import { CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useOfflineQueue } from './useOfflineQueue';

/**
 * B1-PR5 — topbar chip that surfaces the offline queue state.
 *
 * Three states:
 *   1. Hidden — online AND queue empty (the default). Don't pollute the
 *      topbar when nothing's happening.
 *   2. Yellow chip — offline (regardless of count). Signals "your edits
 *      are buffered, we'll replay on reconnect".
 *   3. Blue chip — online with pending mutations. Spinner + count.
 *      This is the brief window after reconnect while replay drains.
 *
 * We listen to `navigator.onLine` directly here (not just the hook) so
 * the chip flips the instant the browser fires `offline`, even before
 * the next interval tick.
 */
export function OfflineIndicator(): JSX.Element | null {
  const { pendingCount, isReplaying, lastError } = useOfflineQueue();
  const [online, setOnline] = React.useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  React.useEffect(() => {
    const on = (): void => setOnline(true);
    const off = (): void => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  if (online && pendingCount === 0) return null;

  if (!online) {
    return (
      <div
        role="status"
        aria-live="polite"
        data-tour="offline-indicator"
        className={cn(
          'hidden h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium sm:inline-flex',
          'border-amber-400/70 bg-amber-100/70 text-amber-900 dark:bg-amber-500/20 dark:text-amber-100',
        )}
        title={
          pendingCount > 0
            ? `Offline — ${pendingCount} modificări vor fi sincronizate la reconectare`
            : 'Offline — modificările se vor sincroniza la reconectare'
        }
      >
        <CloudOff size={12} />
        <span>
          {pendingCount > 0 ? `Offline (${pendingCount})` : 'Offline'}
        </span>
      </div>
    );
  }

  // Online with queued items — draining.
  return (
    <div
      role="status"
      aria-live="polite"
      data-tour="offline-indicator"
      className={cn(
        'hidden h-8 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium sm:inline-flex',
        'border-sky-400/70 bg-sky-100/70 text-sky-900 dark:bg-sky-500/20 dark:text-sky-100',
      )}
      title={lastError ?? `Se sincronizează ${pendingCount} modificări...`}
    >
      <RefreshCw size={12} className={isReplaying ? 'animate-spin' : ''} />
      <span>Sincronizare {pendingCount}</span>
    </div>
  );
}
