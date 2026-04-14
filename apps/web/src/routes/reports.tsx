import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface DealStats {
  total: number; open: number; won: number; lost: number;
  totalValue: number; wonValue: number; avgDealValue: number;
}
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

export const reportsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/reports',
  component: ReportsPage,
});

function fmt(n: number, decimals = 0): string {
  return n.toLocaleString('ro-RO', { maximumFractionDigits: decimals });
}

function StatCard({ title, value, sub }: { title: string; value: string | number; sub?: string }): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function ReportsPage(): JSX.Element {
  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ['reports-dashboard', fromDate, toDate],
    queryFn: () => api.get<DashboardStats>('/reports/dashboard', { from: fromDate, to: toDate }),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Se încarcă rapoartele…</p>;
  if (!data) return <p className="text-sm text-muted-foreground">Nicio dată.</p>;

  const { deals, activities, emails, calls, pipeline, period } = data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Rapoarte</h1>
        <p className="text-sm text-muted-foreground">
          Perioadă: {period.from} → {period.to} (ultimele 30 zile)
        </p>
      </div>

      {/* Deals KPIs */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Deal-uri</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total deals" value={deals.total} />
          <StatCard title="Deschise" value={deals.open} />
          <StatCard title="Câștigate" value={deals.won} sub={`${fmt(deals.wonValue, 0)} RON`} />
          <StatCard title="Pierdute" value={deals.lost} />
        </div>
      </section>

      {/* Pipeline by stage */}
      {pipeline.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Pipeline pe etape</h2>
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Etapă</th>
                  <th className="text-right px-4 py-2 font-medium">Deals</th>
                  <th className="text-right px-4 py-2 font-medium">Valoare (RON)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {pipeline.map((s) => (
                  <tr key={s.stageId} className="hover:bg-muted/30">
                    <td className="px-4 py-2">{s.stageName}</td>
                    <td className="px-4 py-2 text-right">{s.count}</td>
                    <td className="px-4 py-2 text-right">{fmt(Number(s.totalValue), 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Activities + Email + Calls */}
      <div className="grid gap-6 lg:grid-cols-3">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Activitate</h2>
          <div className="grid gap-3">
            <StatCard title="Activități total" value={activities.total} />
          </div>
          {activities.byType.slice(0, 5).map((a) => (
            <div key={a.type} className="mt-2 flex justify-between text-sm">
              <span className="text-muted-foreground">{a.type}</span>
              <span className="font-medium">{a.count}</span>
            </div>
          ))}
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Email-uri</h2>
          <div className="grid gap-3">
            <StatCard title="Trimise" value={emails.sent} />
            <StatCard title="Eșuate" value={emails.failed} />
            <StatCard title="În coadă" value={emails.queued} />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Apeluri</h2>
          <div className="grid gap-3">
            <StatCard title="Total apeluri" value={calls.total} />
            <StatCard
              title="Finalizate"
              value={calls.completed}
              sub={`${fmt(calls.totalDurationSec / 60, 1)} min total`}
            />
            <StatCard
              title="Durată medie"
              value={`${fmt(calls.avgDurationSec, 0)}s`}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
