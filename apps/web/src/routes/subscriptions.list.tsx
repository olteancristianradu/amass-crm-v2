import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { customerSubsApi, type CustomerSubscriptionStatus } from '@/features/customer-subscriptions/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { QueryError } from '@/components/ui/QueryError';

export const subscriptionsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/subscriptions',
  component: SubscriptionsListPage,
});

const STATUS_LABELS: Record<CustomerSubscriptionStatus, string> = {
  ACTIVE: 'Activ', PAUSED: 'Pauzat', CANCELLED: 'Anulat', EXPIRED: 'Expirat',
};

function NewSubForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('');
  const [mrr, setMrr] = useState('');
  const [startDate, setStartDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => customerSubsApi.create({ companyId, name, plan: plan || undefined, mrr, startDate }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['customer-subscriptions'] });
      onDone();
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Eroare la creare.'),
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Abonament nou</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={(e) => { e.preventDefault(); setError(null); mut.mutate(); }} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1"><Label>Companie (ID)</Label><Input value={companyId} onChange={(e) => setCompanyId(e.target.value)} required /></div>
          <div className="space-y-1"><Label>Nume</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="space-y-1"><Label>Plan</Label><Input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="Basic, Pro, Enterprise…" /></div>
          <div className="space-y-1"><Label>MRR (RON)</Label><Input type="number" step="0.01" value={mrr} onChange={(e) => setMrr(e.target.value)} required /></div>
          <div className="space-y-1 md:col-span-2"><Label>Start</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required /></div>
          <div className="md:col-span-2">
            {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={mut.isPending}>{mut.isPending ? 'Se salvează…' : 'Salvează'}</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SubscriptionsListPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: snapshot } = useQuery({
    queryKey: ['customer-subscriptions', 'snapshot'],
    queryFn: () => customerSubsApi.snapshot(),
  });
  const { data, isError, error } = useQuery({
    queryKey: ['customer-subscriptions', 'list'],
    queryFn: () => customerSubsApi.list({ limit: 100 }),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => customerSubsApi.update(id, { status: 'CANCELLED' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['customer-subscriptions'] }),
  });

  const rows = data?.data ?? [];
  const curr = snapshot?.currency ?? 'RON';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Abonamente Clienți (MRR)</h1>
        <Button onClick={() => setShowForm((v) => !v)}>{showForm ? 'Anulează' : '+ Abonament'}</Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">MRR</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{(snapshot?.mrr ?? 0).toLocaleString('ro-RO', { maximumFractionDigits: 0 })} {curr}</div></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">ARR</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{(snapshot?.arr ?? 0).toLocaleString('ro-RO', { maximumFractionDigits: 0 })} {curr}</div></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Active</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{snapshot?.activeCount ?? 0}</div></CardContent></Card>
        <Card><CardHeader className="pb-1"><CardTitle className="text-sm text-muted-foreground">Churn (30d)</CardTitle></CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{((snapshot?.churnRate ?? 0) * 100).toFixed(1)}%</div>
            <div className="text-xs text-muted-foreground">{snapshot?.cancelledLast30d ?? 0} anulări</div>
          </CardContent></Card>
      </div>

      {snapshot && snapshot.byPlan.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-lg">Pe plan</CardTitle></CardHeader>
          <CardContent className="grid gap-2 md:grid-cols-3">
            {snapshot.byPlan.map((p) => (
              <div key={p.plan} className="rounded border p-3">
                <div className="text-xs text-muted-foreground">{p.plan}</div>
                <div className="text-lg font-semibold">{p.mrr.toLocaleString('ro-RO')} {curr}/lună</div>
                <div className="text-xs text-muted-foreground">{p.count} clienți</div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {showForm && <NewSubForm onDone={() => setShowForm(false)} />}

      <QueryError isError={isError} error={error} label="Nu am putut încărca abonamentele." />

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Nume</th>
                <th scope="col" className="px-4 py-2 font-medium">Plan</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 font-medium text-right">MRR</th>
                <th scope="col" className="px-4 py-2 font-medium">Start</th>
                <th scope="col" className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Niciun abonament.</td></tr>}
              {rows.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2 font-medium">{s.name}</td>
                  <td className="px-4 py-2 text-xs">{s.plan ?? '—'}</td>
                  <td className="px-4 py-2"><span className="text-xs">{STATUS_LABELS[s.status]}</span></td>
                  <td className="px-4 py-2 text-right font-mono text-xs">{Number(s.mrr).toLocaleString('ro-RO')} {s.currency}</td>
                  <td className="px-4 py-2 text-xs">{new Date(s.startDate).toLocaleDateString('ro-RO')}</td>
                  <td className="px-4 py-2">
                    {s.status === 'ACTIVE' && (
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm('Anulezi abonamentul?')) cancelMut.mutate(s.id); }}>Anulează</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
