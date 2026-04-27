import { createRoute } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Activity, ShieldX } from 'lucide-react';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { EmptyState, ListSurface, PageHeader } from '@/components/ui/page-header';

export const auditRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/audit',
  component: AuditPage,
});

interface AuditLog {
  id: string;
  action: string;
  actorId: string | null;
  subjectType: string | null;
  subjectId: string | null;
  ipAddress: string | null;
  createdAt: string;
  metadata: Record<string, unknown> | null;
}

interface AuditPage {
  data: AuditLog[];
  nextCursor: string | null;
}

function AuditPage(): JSX.Element {
  const user = useAuthStore((s) => s.user);

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
      api.get<AuditPage>('/audit', { cursor: pageParam, limit: '50' }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last: AuditPage) => last.nextCursor ?? undefined,
    enabled: user?.role === 'OWNER' || user?.role === 'ADMIN',
  });

  if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') {
    return (
      <div>
        <PageHeader title="Jurnal audit" subtitle="Acces restricționat — doar OWNER și ADMIN." />
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={ShieldX}
            title="Acces restricționat"
            description="Această pagină este vizibilă doar utilizatorilor cu rol OWNER sau ADMIN."
          />
        </GlassCard>
      </div>
    );
  }

  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div>
      <PageHeader
        title="Jurnal audit"
        subtitle="Cronologic, toate evenimentele de securitate și schimbările sensibile."
      />

      <ListSurface>
        {isLoading ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Se încarcă…</p>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="Niciun eveniment înregistrat"
            description="Audit log-ul se populează automat la prima acțiune sensibilă (login, creare, ștergere, etc)."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Acțiune</th>
                  <th scope="col" className="px-4 py-3 font-medium">Actor</th>
                  <th scope="col" className="px-4 py-3 font-medium">Subiect</th>
                  <th scope="col" className="px-4 py-3 font-medium">IP</th>
                  <th scope="col" className="px-4 py-3 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((log) => (
                  <tr
                    key={log.id}
                    className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40"
                  >
                    <td className="px-4 py-3 font-mono text-xs">{log.action}</td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {log.actorId ?? '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {log.subjectType ? `${log.subjectType}:${log.subjectId ?? '?'}` : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                      {log.ipAddress ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs tabular-nums text-muted-foreground">
                      {new Date(log.createdAt).toLocaleString('ro-RO')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListSurface>

      {hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? 'Se încarcă…' : 'Mai mult'}
          </Button>
        </div>
      )}
    </div>
  );
}
