import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { commissionsApi } from '@/features/commissions/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { QueryError } from '@/components/ui/QueryError';

export const commissionsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/commissions',
  component: CommissionsPage,
});

function CommissionsPage(): JSX.Element {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [newPlanName, setNewPlanName] = useState('');
  const [newPlanPercent, setNewPlanPercent] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: plans } = useQuery({ queryKey: ['commission-plans'], queryFn: () => commissionsApi.listPlans() });
  const { data: commissions, isError, error: queryError } = useQuery({
    queryKey: ['commissions', year, month],
    queryFn: () => commissionsApi.list(year, month),
  });

  const createPlanMut = useMutation({
    mutationFn: () => commissionsApi.createPlan({ name: newPlanName, percent: newPlanPercent }),
    onSuccess: async () => {
      setNewPlanName(''); setNewPlanPercent('');
      await qc.invalidateQueries({ queryKey: ['commission-plans'] });
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Eroare.'),
  });

  const computeMut = useMutation({
    mutationFn: () => commissionsApi.compute({ year, month, planId: selectedPlan }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['commissions'] });
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Eroare la calcul.'),
  });

  const payMut = useMutation({
    mutationFn: (id: string) => commissionsApi.markPaid(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['commissions'] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Comisioane Vânzări</h1>

      <Card>
        <CardHeader><CardTitle className="text-lg">Planuri comision</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input placeholder="Nume plan" value={newPlanName} onChange={(e) => setNewPlanName(e.target.value)} />
            <Input placeholder="% (ex. 5)" type="number" step="0.1" value={newPlanPercent} onChange={(e) => setNewPlanPercent(e.target.value)} />
            <Button onClick={() => createPlanMut.mutate()} disabled={!newPlanName || !newPlanPercent || createPlanMut.isPending}>Adaugă</Button>
          </div>
          <table className="w-full text-sm">
            <thead className="border-b text-left">
              <tr><th scope="col" className="px-2 py-1">Nume</th><th scope="col" className="px-2 py-1 text-right">%</th><th scope="col" className="px-2 py-1">Activ</th></tr>
            </thead>
            <tbody>
              {(plans ?? []).map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-2 py-1">{p.name}</td>
                  <td className="px-2 py-1 text-right font-mono">{Number(p.percent).toFixed(2)}%</td>
                  <td className="px-2 py-1">{p.isActive ? 'Da' : 'Nu'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Calcul lunar</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-2">
            <div><Label>An</Label><Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
            <div><Label>Lună</Label><Input type="number" min={1} max={12} value={month} onChange={(e) => setMonth(Number(e.target.value))} /></div>
            <div>
              <Label>Plan</Label>
              <select className="h-9 rounded-md border border-input px-3 text-sm" value={selectedPlan} onChange={(e) => setSelectedPlan(e.target.value)}>
                <option value="">— alege —</option>
                {(plans ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <Button onClick={() => computeMut.mutate()} disabled={!selectedPlan || computeMut.isPending}>
              {computeMut.isPending ? 'Se calculează…' : 'Calculează'}
            </Button>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      <QueryError isError={isError} error={queryError} label="Nu am putut încărca comisioanele." />

      <Card>
        <CardHeader><CardTitle className="text-lg">Rezultate {year}/{String(month).padStart(2, '0')}</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left">
              <tr>
                <th scope="col" className="px-4 py-2">Agent</th>
                <th scope="col" className="px-4 py-2 text-right">Deal-uri</th>
                <th scope="col" className="px-4 py-2 text-right">Bază</th>
                <th scope="col" className="px-4 py-2 text-right">Comision</th>
                <th scope="col" className="px-4 py-2">Plătit</th>
                <th scope="col" className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {(commissions ?? []).length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted-foreground">Niciun rezultat. Rulează calculul.</td></tr>}
              {(commissions ?? []).map((c) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="px-4 py-2 font-mono text-xs">{c.userId}</td>
                  <td className="px-4 py-2 text-right">{c.dealsCount}</td>
                  <td className="px-4 py-2 text-right font-mono">{Number(c.basis).toLocaleString('ro-RO')} {c.currency}</td>
                  <td className="px-4 py-2 text-right font-mono font-semibold">{Number(c.amount).toLocaleString('ro-RO')} {c.currency}</td>
                  <td className="px-4 py-2 text-xs">{c.paidAt ? new Date(c.paidAt).toLocaleDateString('ro-RO') : '—'}</td>
                  <td className="px-4 py-2">
                    {!c.paidAt && <Button size="sm" variant="ghost" onClick={() => payMut.mutate(c.id)}>Marchează plătit</Button>}
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
