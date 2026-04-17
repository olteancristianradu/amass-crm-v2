import { createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface DealStats {
  total: number; open: number; won: number; lost: number;
  totalValue: number; wonValue: number; avgDealValue: number;
}
interface ActivityStats { total: number; byType: { type: string; count: number }[] }
interface EmailStats { sent: number; failed: number; queued: number }
interface CallStats { total: number; completed: number; totalDurationSec: number; avgDurationSec: number }
interface PipelineStageStats { stageId: string; stageName: string; count: number; totalValue: number }
interface FinancialRow {
  currency: string; issued: number; overdue: number; paid: number; outstanding: number;
  issuedCount: number; overdueCount: number; paidCount: number;
}
interface DealForecastItem {
  id: string; title: string; value: string; probability: number;
  stageName: string; expectedCloseAt?: string; ownerId?: string;
}

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

type Period = '7d' | '30d' | '90d' | '1y' | 'custom';

function periodDates(period: Period, customFrom: string, customTo: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const days: Partial<Record<Period, number>> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
  if (period === 'custom') return { from: customFrom, to: customTo };
  const d = days[period] ?? 30;
  const from = new Date(now.getTime() - d * 86400000).toISOString().slice(0, 10);
  return { from, to };
}

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
  const [period, setPeriod] = useState<Period>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'financial' | 'forecast'>('overview');

  const { from, to } = periodDates(period, customFrom, customTo);

  const { data, isLoading } = useQuery({
    queryKey: ['reports-dashboard', from, to],
    queryFn: () => api.get<DashboardStats>('/reports/dashboard', { from, to }),
    enabled: !!from && !!to,
  });

  const { data: financial } = useQuery({
    queryKey: ['reports-financial', from, to],
    queryFn: () => api.get<FinancialRow[]>('/reports/financial', { from, to }),
    enabled: activeTab === 'financial' && !!from && !!to,
  });

  const { data: forecastDeals } = useQuery({
    queryKey: ['deals-forecast'],
    queryFn: () =>
      api.get<{ data: DealForecastItem[] }>('/deals', {
        status: 'OPEN', limit: 100,
      }),
    enabled: activeTab === 'forecast',
  });

  const PERIOD_LABELS: Record<Period, string> = {
    '7d': '7 zile', '30d': '30 zile', '90d': '90 zile', '1y': '1 an', custom: 'Personalizat',
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Rapoarte</h1>

        {/* Period selector */}
        <div className="flex items-center gap-2 flex-wrap">
          {(['7d', '30d', '90d', '1y', 'custom'] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`rounded px-3 py-1 text-sm font-medium ${
                period === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
            >
              {PERIOD_LABELS[p]}
            </button>
          ))}
          {period === 'custom' && (
            <div className="flex items-center gap-2">
              <div className="space-y-1">
                <Label className="text-xs">De la</Label>
                <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Până la</Label>
                <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tab navigation */}
      <div className="flex gap-1 border-b">
        {(['overview', 'financial', 'forecast'] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              activeTab === tab
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'overview' ? 'Prezentare generală' : tab === 'financial' ? 'Financiar' : 'Forecast pipeline'}
          </button>
        ))}
      </div>

      {isLoading && activeTab === 'overview' && (
        <p className="text-sm text-muted-foreground">Se încarcă rapoartele…</p>
      )}

      {/* ── Overview tab ─────────────────────────────────────────────── */}
      {activeTab === 'overview' && data && (() => {
        const { deals, activities, emails, calls, pipeline } = data;
        return (
          <div className="space-y-6">
            <p className="text-sm text-muted-foreground">Perioadă: {from} → {to}</p>

            <section>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Deal-uri</h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard title="Total deals" value={deals.total} />
                <StatCard title="Deschise" value={deals.open} />
                <StatCard title="Câștigate" value={deals.won} sub={`${fmt(deals.wonValue, 0)} RON`} />
                <StatCard title="Pierdute" value={deals.lost} />
              </div>
            </section>

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

            <div className="grid gap-6 lg:grid-cols-3">
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">Activitate</h2>
                <StatCard title="Activități total" value={activities.total} />
                {activities.byType.slice(0, 5).map((a) => (
                  <div key={a.type} className="mt-2 flex justify-between text-sm">
                    <span className="text-muted-foreground truncate">{a.type}</span>
                    <span className="font-medium ml-2">{a.count}</span>
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
                  <StatCard title="Finalizate" value={calls.completed} sub={`${fmt(calls.totalDurationSec / 60, 1)} min total`} />
                  <StatCard title="Durată medie" value={`${fmt(calls.avgDurationSec, 0)}s`} />
                </div>
              </section>
            </div>
          </div>
        );
      })()}

      {/* ── Financial tab ─────────────────────────────────────────────── */}
      {activeTab === 'financial' && (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">Perioadă: {from} → {to}</p>
          {!financial && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
          {financial && financial.length === 0 && (
            <p className="text-sm text-muted-foreground">Nicio factură în perioada selectată.</p>
          )}
          {financial && financial.length > 0 && (
            <div className="space-y-4">
              {financial.map((row) => (
                <div key={row.currency}>
                  <h3 className="font-medium mb-2">{row.currency}</h3>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatCard title="Emise" value={`${fmt(row.issued, 0)} ${row.currency}`} sub={`${row.issuedCount} facturi`} />
                    <StatCard title="Plătite" value={`${fmt(row.paid, 0)} ${row.currency}`} sub={`${row.paidCount} facturi`} />
                    <StatCard title="Restante" value={`${fmt(row.overdue, 0)} ${row.currency}`} sub={`${row.overdueCount} facturi`} />
                    <StatCard title="De încasat" value={`${fmt(row.outstanding, 0)} ${row.currency}`} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Forecast tab (S34) ────────────────────────────────────────── */}
      {activeTab === 'forecast' && (
        <ForecastView deals={forecastDeals?.data ?? []} />
      )}
    </div>
  );
}

// ── Deal Forecast (S34) ───────────────────────────────────────────────────────

function ForecastView({ deals }: { deals: DealForecastItem[] }): JSX.Element {
  const [probOverrides, setProbOverrides] = useState<Record<string, number>>({});

  function getProb(d: DealForecastItem): number {
    return probOverrides[d.id] ?? d.probability ?? 50;
  }

  const weightedTotal = deals.reduce((acc, d) => {
    const value = parseFloat(d.value ?? '0');
    const prob = getProb(d) / 100;
    return acc + value * prob;
  }, 0);

  const rawTotal = deals.reduce((acc, d) => acc + parseFloat(d.value ?? '0'), 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard title="Deal-uri deschise" value={deals.length} />
        <StatCard title="Valoare brută" value={`${deals.length > 0 ? fmt(rawTotal, 0) : 0} RON`} />
        <StatCard
          title="Forecast ponderat"
          value={`${fmt(weightedTotal, 0)} RON`}
          sub="Σ valoare × probabilitate"
        />
      </div>

      {deals.length === 0 && (
        <p className="text-sm text-muted-foreground">Niciun deal deschis.</p>
      )}

      {deals.length > 0 && (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Deal</th>
                <th className="text-left px-4 py-2 font-medium">Etapă</th>
                <th className="text-right px-4 py-2 font-medium">Valoare</th>
                <th className="px-4 py-2 font-medium">Probabilitate</th>
                <th className="text-right px-4 py-2 font-medium">Forecast</th>
                <th className="text-left px-4 py-2 font-medium">Închidere est.</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {deals.map((d) => {
                const value = parseFloat(d.value ?? '0');
                const prob = getProb(d);
                const forecast = value * (prob / 100);
                return (
                  <tr key={d.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{d.title}</td>
                    <td className="px-4 py-2 text-muted-foreground">{(d as { stageName?: string }).stageName ?? '—'}</td>
                    <td className="px-4 py-2 text-right font-mono">{fmt(value, 0)} RON</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="range"
                          min={0} max={100} step={5}
                          value={prob}
                          onChange={(e) => setProbOverrides((p) => ({ ...p, [d.id]: parseInt(e.target.value, 10) }))}
                          className="w-28"
                        />
                        <span className="text-xs font-mono w-8">{prob}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-primary">{fmt(forecast, 0)} RON</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {d.expectedCloseAt ? new Date(d.expectedCloseAt).toLocaleDateString('ro-RO') : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t bg-muted/30">
              <tr>
                <td colSpan={2} className="px-4 py-2 font-medium">Total</td>
                <td className="px-4 py-2 text-right font-mono font-medium">{fmt(rawTotal, 0)} RON</td>
                <td className="px-4 py-2" />
                <td className="px-4 py-2 text-right font-mono font-bold text-primary">{fmt(weightedTotal, 0)} RON</td>
                <td className="px-4 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
