import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { forecastingApi } from '@/features/forecasting/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';

export const forecastingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/forecasting',
  component: ForecastingPage,
});

const MONTHS = [
  'Ianuarie', 'Februarie', 'Martie', 'Aprilie', 'Mai', 'Iunie',
  'Iulie', 'August', 'Septembrie', 'Octombrie', 'Noiembrie', 'Decembrie',
];

function fmt(n: number): string {
  return n.toLocaleString('ro-RO', { maximumFractionDigits: 0 });
}

function ProgressBar({ value, max }: { value: number; max: number }): JSX.Element {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const color = pct >= 100 ? 'bg-green-500' : pct >= 70 ? 'bg-yellow-500' : 'bg-blue-500';
  return (
    <div className="mt-1 h-2 w-full rounded-full bg-muted">
      <div className={`h-2 rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function KpiCard({
  title,
  value,
  sub,
  quota,
  currency = 'RON',
}: {
  title: string;
  value: number;
  sub?: string;
  quota?: number | null;
  currency?: string;
}): JSX.Element {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {fmt(value)} <span className="text-sm font-normal text-muted-foreground">{currency}</span>
        </div>
        {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        {quota != null && quota > 0 && (
          <>
            <ProgressBar value={value} max={quota} />
            <p className="mt-1 text-xs text-muted-foreground">
              {Math.round((value / quota) * 100)}% din target {fmt(quota)} {currency}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function SetQuotaForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const now = new Date();
  const [userId, setUserId] = useState('');
  const [year, setYear] = useState(now.getFullYear());
  const [period, setPeriod] = useState(now.getMonth() + 1);
  const [quota, setQuota] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      forecastingApi.setQuota({ userId, year, period, periodType: 'MONTH', value: Number(quota) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['forecasting'] });
      onDone();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Eroare la salvare.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Setează target</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => { e.preventDefault(); setError(null); mut.mutate(); }}
          className="grid gap-3 sm:grid-cols-4"
        >
          <div className="space-y-1">
            <Label htmlFor="fc-user">User ID</Label>
            <Input id="fc-user" value={userId} onChange={(e) => setUserId(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fc-year">An</Label>
            <Input id="fc-year" type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="fc-period">Lună</Label>
            <select
              id="fc-period"
              value={period}
              onChange={(e) => setPeriod(Number(e.target.value))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fc-quota">Target (RON)</Label>
            <Input
              id="fc-quota"
              value={quota}
              onChange={(e) => setQuota(e.target.value)}
              placeholder="50000"
              inputMode="decimal"
              required
            />
          </div>
          <div className="sm:col-span-4">
            {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={mut.isPending}>
              {mut.isPending ? 'Se salvează…' : 'Salvează target'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ForecastingPage(): JSX.Element {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [period, setPeriod] = useState(now.getMonth() + 1);
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['forecasting', year, period],
    queryFn: () => forecastingApi.getForecast(year, period, 'MONTH'),
  });

  const rows = data?.rows ?? [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Prognoze Vânzări</h1>
        <div className="flex items-center gap-2">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {[now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Anulează' : 'Setează target'}
          </Button>
        </div>
      </div>

      {showForm && <SetQuotaForm onDone={() => setShowForm(false)} />}

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}><CardContent className="h-24 animate-pulse bg-muted/40 rounded" /></Card>
          ))}
        </div>
      )}

      {isError && (
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {data && (
        <>
          {/* KPI cards */}
          <div className="grid gap-4 sm:grid-cols-3">
            <KpiCard
              title="Pipeline total (ponderat)"
              value={data.pipeline ?? 0}
              sub="Suma deals × probabilitate"
              quota={data.quota ?? null}
              currency={data.currency}
            />
            <KpiCard
              title="Commit (≥ 70% probabilitate)"
              value={data.commit ?? 0}
              sub="Deals cu șanse mari de închidere"
              currency={data.currency}
            />
            <KpiCard
              title="Target"
              value={data.quota ?? 0}
              sub="Target lunar setat"
              currency={data.currency}
            />
          </div>

          {/* Per-user table */}
          {rows.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Detaliu per reprezentant</CardTitle>
              </CardHeader>
              <CardContent className="p-0 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-left">
                    <tr>
                      <th scope="col" className="px-4 py-2 font-medium">Reprezentant</th>
                      <th scope="col" className="px-4 py-2 font-medium text-right">Deals open</th>
                      <th scope="col" className="px-4 py-2 font-medium text-right">Pipeline</th>
                      <th scope="col" className="px-4 py-2 font-medium text-right">Commit</th>
                      <th scope="col" className="px-4 py-2 font-medium text-right">Target</th>
                      <th scope="col" className="px-4 py-2 font-medium text-right">%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => {
                      const pct = row.quota ? Math.round((row.commit / row.quota) * 100) : null;
                      return (
                        <tr key={row.userId} className="border-b last:border-0 hover:bg-muted/30">
                          <td className="px-4 py-2 font-medium">
                            {row.userName ?? row.userId}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{row.dealsOpen}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt(row.pipeline)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmt(row.commit)}</td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {row.quota != null ? fmt(row.quota) : '—'}
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">
                            {pct != null ? (
                              <span className={pct >= 100 ? 'text-green-600 font-semibold' : pct >= 70 ? 'text-yellow-600' : 'text-muted-foreground'}>
                                {pct}%
                              </span>
                            ) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {rows.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                Nu există deals cu dată de închidere în {MONTHS[period - 1]} {year}.
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
