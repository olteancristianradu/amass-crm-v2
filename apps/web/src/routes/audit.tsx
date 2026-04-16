import { createRoute } from '@tanstack/react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      queryKey: ['audit'],
      queryFn: ({ pageParam }: { pageParam: string | undefined }) =>
        api.get<AuditPage>('/audit', { cursor: pageParam, limit: '50' }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last: AuditPage) => last.nextCursor ?? undefined,
      enabled: user?.role === 'OWNER' || user?.role === 'ADMIN',
    });

  if (user?.role !== 'OWNER' && user?.role !== 'ADMIN') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold">Jurnal audit</h1>
        <p className="text-muted-foreground">Acces restricționat — doar OWNER și ADMIN.</p>
      </div>
    );
  }

  const rows = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Jurnal audit</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Evenimente de securitate</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Se încarcă…</p>
          ) : rows.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">Niciun eveniment înregistrat.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs text-muted-foreground">
                    <th className="px-4 py-2 text-left font-medium">Acțiune</th>
                    <th className="px-4 py-2 text-left font-medium">Actor</th>
                    <th className="px-4 py-2 text-left font-medium">Subiect</th>
                    <th className="px-4 py-2 text-left font-medium">IP</th>
                    <th className="px-4 py-2 text-left font-medium">Data</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((log) => (
                    <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-xs">{log.action}</td>
                      <td className="px-4 py-2 text-muted-foreground">{log.actorId ?? '—'}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {log.subjectType ? `${log.subjectType}:${log.subjectId ?? '?'}` : '—'}
                      </td>
                      <td className="px-4 py-2 text-muted-foreground">{log.ipAddress ?? '—'}</td>
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                        {new Date(log.createdAt).toLocaleString('ro-RO')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hasNextPage && (
            <div className="flex justify-center p-4">
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
        </CardContent>
      </Card>
    </div>
  );
}
