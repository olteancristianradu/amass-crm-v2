import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi, type Notification } from '@/features/notifications/api';

/**
 * Notification bell icon with unread badge. On click shows a dropdown
 * with recent unread notifications and a "mark all read" action.
 *
 * Polls every 60 s — lightweight enough for a solo-dev CRM, proper WS
 * push can be added in a later sprint.
 */
export function NotificationsBell(): JSX.Element {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: () => notificationsApi.listUnread(),
    // Refresh every 60 s silently in background
    refetchInterval: 60_000,
  });

  const markReadMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAllReadMut = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent): void {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  return (
    <div ref={containerRef} className="relative">
      {/* Bell button */}
      <button
        type="button"
        aria-label={`Notificări${unreadCount > 0 ? ` — ${unreadCount} necitite` : ''}`}
        onClick={() => setOpen((v) => !v)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-10 z-50 w-80 rounded-lg border bg-background shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <span className="text-sm font-semibold">Notificări</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={() => markAllReadMut.mutate()}
                disabled={markAllReadMut.isPending}
                className="text-xs text-primary hover:underline disabled:opacity-60"
              >
                Marchează toate citite
              </button>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                Nicio notificare necitită.
              </p>
            )}
            {notifications.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onMarkRead={() => markReadMut.mutate(n.id)}
                isPending={markReadMut.isPending}
              />
            ))}
          </div>

          {notifications.length > 0 && (
            <div className="border-t px-4 py-2">
              <p className="text-xs text-muted-foreground text-center">
                Afișând cele mai recente {notifications.length} notificări necitite
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface NotificationItemProps {
  notification: Notification;
  onMarkRead: () => void;
  isPending: boolean;
}

function NotificationItem({ notification, onMarkRead, isPending }: NotificationItemProps): JSX.Element {
  return (
    <div
      className={`flex items-start gap-3 border-b px-4 py-3 last:border-0 ${
        !notification.isRead ? 'bg-primary/5' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium leading-snug">{notification.title}</p>
        {notification.body && (
          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-2">{notification.body}</p>
        )}
        <p className="mt-1 text-[10px] text-muted-foreground">
          {formatRelative(notification.createdAt)}
        </p>
      </div>
      {!notification.isRead && (
        <button
          type="button"
          onClick={onMarkRead}
          disabled={isPending}
          title="Marchează citit"
          className="mt-0.5 shrink-0 h-2 w-2 rounded-full bg-primary hover:bg-primary/70 transition-colors disabled:opacity-50"
          aria-label="Marchează ca citit"
        />
      )}
    </div>
  );
}

/** Simple relative-time formatter (no external lib needed). */
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'acum câteva secunde';
  if (minutes < 60) return `acum ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `acum ${hours} ${hours === 1 ? 'oră' : 'ore'}`;
  const days = Math.floor(hours / 24);
  return `acum ${days} ${days === 1 ? 'zi' : 'zile'}`;
}

function BellIcon(): JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
