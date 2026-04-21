import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { authedRoute } from './authed';
import { notificationsApi, type Notification, type NotificationType } from '@/features/notifications/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { QueryError } from '@/components/ui/QueryError';

/**
 * M-13 — Notification center.
 *
 * The top-bar bell shows only unread items (max ~20). This page is the
 * full inbox: both read + unread, with filter tabs, mark-as-read, mark-all-
 * read, and a deep link through the notification's `link` field when set.
 */
export const notificationsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/notifications',
  component: NotificationsPage,
});

type Filter = 'all' | 'unread';

function NotificationsPage(): JSX.Element {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['notifications', 'list', { filter }],
    queryFn: () => (filter === 'unread' ? notificationsApi.listUnread() : notificationsApi.listAll(100)),
  });

  // L-4: optimistic updates — row flips instantly to read state.
  const markReadMut = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      const prev = qc.getQueriesData<Notification[]>({ queryKey: ['notifications'] });
      for (const [key, list] of prev) {
        if (!list) continue;
        qc.setQueryData<Notification[]>(
          key,
          list.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
        );
      }
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      for (const [key, list] of ctx?.prev ?? []) qc.setQueryData(key, list);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const markAllReadMut = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: ['notifications'] });
      const prev = qc.getQueriesData<Notification[]>({ queryKey: ['notifications'] });
      for (const [key, list] of prev) {
        if (!list) continue;
        qc.setQueryData<Notification[]>(
          key,
          list.map((n) => ({ ...n, isRead: true })),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      for (const [key, list] of ctx?.prev ?? []) qc.setQueryData(key, list);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unreadCount = useMemo(
    () => (data ?? []).filter((n) => !n.isRead).length,
    [data],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Notificări</h1>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-md border p-1">
            <TabButton active={filter === 'all'} onClick={() => setFilter('all')}>
              Toate
            </TabButton>
            <TabButton active={filter === 'unread'} onClick={() => setFilter('unread')}>
              Necitite{unreadCount > 0 ? ` (${unreadCount})` : ''}
            </TabButton>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAllReadMut.mutate()}
            disabled={markAllReadMut.isPending || unreadCount === 0}
          >
            Marchează toate citite
          </Button>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={isError} error={error} label="Nu am putut încărca notificările." />

      {data && data.length === 0 && !isLoading && (
        <p className="text-sm text-muted-foreground">
          {filter === 'unread' ? 'Nicio notificare necitită.' : 'Nu există notificări.'}
        </p>
      )}

      <div className="space-y-2">
        {data?.map((n) => (
          <NotificationRow
            key={n.id}
            n={n}
            onMarkRead={() => markReadMut.mutate(n.id)}
            pending={markReadMut.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function NotificationRow({
  n,
  onMarkRead,
  pending,
}: {
  n: Notification;
  onMarkRead: () => void;
  pending: boolean;
}): JSX.Element {
  return (
    <Card className={n.isRead ? '' : 'border-primary/40 bg-primary/5'}>
      <CardContent className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {typeLabel(n.type)}
            </span>
            {!n.isRead && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Necitită" />}
          </div>
          <p className="mt-1 font-medium leading-snug">{n.title}</p>
          {n.body && <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {new Date(n.createdAt).toLocaleString('ro-RO')}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {n.link && (
            <a
              href={n.link}
              className="text-xs text-primary hover:underline"
            >
              Deschide
            </a>
          )}
          {!n.isRead && (
            <Button size="sm" variant="ghost" onClick={onMarkRead} disabled={pending}>
              Marchează citit
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function typeLabel(t: NotificationType): string {
  switch (t) {
    case 'REMINDER_FIRED':
      return 'Reminder';
    case 'DEAL_ASSIGNED':
      return 'Deal';
    case 'TASK_ASSIGNED':
      return 'Task';
    case 'APPROVAL_REQUESTED':
      return 'Aprobare';
    case 'APPROVAL_DECIDED':
      return 'Aprobare';
    case 'INVOICE_OVERDUE':
      return 'Factură';
    case 'MENTION':
      return 'Mențiune';
    case 'SYSTEM':
      return 'Sistem';
  }
}
