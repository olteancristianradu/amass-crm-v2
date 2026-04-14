import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';

export const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: Dashboard,
});

interface DealStats { total: number; open: number; won: number; lost: number; totalValue: number; wonValue: number; avgDealValue: number }
interface ActivityStats { total: number; byType: { type: string; count: number }[] }
interface EmailStats { sent: number; failed: number; queued: number }
interface CallStats { total: number; completed: number; totalDurationSec: number; avgDurationSec: number }
interface PipelineStageStats { stageId: string; stageName: string; count: number; totalValue: number }
interface DashboardStats {
  deals: DealStats;
  pipeline: PipelineStageStats[];
  activities: ActivityStats;
  emails: EmailStats;
  calls: CallStats;
  period: { from: string; to: string };
}

function KpiCard({ title, value, sub, href }: { title: string; value: string | number; sub?: string; href?: string }): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {href ? (
          <Link to={href} className="text-2xl font-bold hover:underline">
            {value}
          </Link>
        ) : (
          <div className="text-2xl font-bold">{value}</div>
        )}
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function Dashboard(): JSX.Element {
  const user = useAuthStore((s) => s.user);

  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const { data } = useQuery({
    queryKey: ['reports-dashboard', fromDate, toDate],
    queryFn: () => api.get<DashboardStats>('/reports/dashboard', { from: fromDate, to: toDate }),
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Bun venit, {user?.fullName ?? '—'}</h1>
        <p className="text-sm text-muted-foreground">Ultimele 30 zile</p>
      </div>

      {/* Deals KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Deals deschise"
          value={data?.deals.open ?? '—'}
          sub={`${data?.deals.total ?? 0} total`}
          href="/app/reports"
        />
        <KpiCard
          title="Deals câștigate"
          value={data?.deals.won ?? '—'}
          sub={data ? `${data.deals.wonValue.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON` : undefined}
        />
        <KpiCard
          title="Apeluri"
          value={data?.calls.total ?? '—'}
          sub={data ? `${data.calls.completed} finalizate` : undefined}
        />
        <KpiCard
          title="Email-uri trimise"
          value={data?.emails.sent ?? '—'}
          sub={data ? `${data.emails.queued} în coadă` : undefined}
        />
      </div>

      {/* Pipeline */}
      {data && data.pipeline.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pipeline pe etape</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Etapă</th>
                  <th className="px-4 py-2 text-right font-medium">Deals</th>
                  <th className="px-4 py-2 text-right font-medium">Valoare (RON)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.pipeline.map((s) => (
                  <tr key={s.stageId} className="hover:bg-muted/30">
                    <td className="px-4 py-2">{s.stageName}</td>
                    <td className="px-4 py-2 text-right">{s.count}</td>
                    <td className="px-4 py-2 text-right">
                      {Number(s.totalValue).toLocaleString('ro-RO', { maximumFractionDigits: 0 })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Activity breakdown */}
      {data && data.activities.byType.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Activitate ({data.activities.total} total)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-1">
              {data.activities.byType.slice(0, 6).map((a) => (
                <div key={a.type} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{a.type}</span>
                  <span className="font-medium">{a.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {!data && (
        <p className="text-sm text-muted-foreground">Se încarcă statisticile…</p>
      )}
    </div>
  );
}
