import { createRoute, Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { projectsApi } from '@/features/projects/api';
import { invoicesApi } from '@/features/invoices/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import type { InvoiceCurrency, ProjectStatus } from '@/lib/types';

export const projectDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/projects/$id',
  component: ProjectDetailPage,
});

function ProjectDetailPage(): JSX.Element {
  const { id } = useParams({ from: '/app/projects/$id' });
  const qc = useQueryClient();
  const projectQ = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id),
  });

  // Invoices tied to this project's deal (if any). Fallback to company-level.
  const invoicesQ = useQuery({
    queryKey: ['invoices', 'by-project', id],
    queryFn: async () => {
      const p = projectQ.data;
      if (!p) return { data: [], nextCursor: null };
      return invoicesApi.list({
        ...(p.dealId ? { dealId: p.dealId } : { companyId: p.companyId }),
        limit: 50,
      });
    },
    enabled: !!projectQ.data,
  });

  const [edit, setEdit] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('PLANNED');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [budget, setBudget] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const openEdit = (): void => {
    const p = projectQ.data;
    if (!p) return;
    setName(p.name);
    setDescription(p.description ?? '');
    setStatus(p.status);
    setStartDate(p.startDate ? p.startDate.slice(0, 10) : '');
    setEndDate(p.endDate ? p.endDate.slice(0, 10) : '');
    setBudget(p.budget ?? '');
    setEdit(true);
  };

  const save = useMutation({
    mutationFn: () =>
      projectsApi.update(id, {
        name: name.trim(),
        description: description.trim() || null,
        status,
        startDate: startDate ? new Date(startDate).toISOString() : null,
        endDate: endDate ? new Date(endDate).toISOString() : null,
        budget: budget.trim() || null,
      }),
    onSuccess: async () => {
      setEdit(false);
      setErr(null);
      await qc.invalidateQueries({ queryKey: ['project', id] });
      await qc.invalidateQueries({ queryKey: ['projects', 'list'] });
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Eroare'),
  });

  if (projectQ.isLoading) {
    return <p className="text-sm text-muted-foreground">Se încarcă…</p>;
  }
  if (!projectQ.data) return <p>Proiectul nu a fost găsit.</p>;
  const p = projectQ.data;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/app/projects" className="text-sm text-muted-foreground hover:underline">
            ← Proiecte
          </Link>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
        </div>
        <Button variant="outline" onClick={edit ? () => setEdit(false) : openEdit}>
          {edit ? 'Anulează' : 'Editează'}
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Detalii</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!edit && (
            <dl className="grid grid-cols-2 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Status</dt><dd>{statusLabel(p.status)}</dd>
              <dt className="text-muted-foreground">Companie</dt>
              <dd>
                <Link to="/app/companies/$id" params={{ id: p.companyId }} className="hover:underline">
                  Vezi compania
                </Link>
              </dd>
              <dt className="text-muted-foreground">Deal legat</dt>
              <dd>{p.dealId ?? '—'}</dd>
              <dt className="text-muted-foreground">Start</dt>
              <dd>{p.startDate ? new Date(p.startDate).toLocaleDateString('ro-RO') : '—'}</dd>
              <dt className="text-muted-foreground">Finalizare</dt>
              <dd>{p.endDate ? new Date(p.endDate).toLocaleDateString('ro-RO') : '—'}</dd>
              <dt className="text-muted-foreground">Buget</dt>
              <dd>{p.budget ? formatMoney(p.budget, p.currency) : '—'}</dd>
              {p.description && (
                <>
                  <dt className="text-muted-foreground">Descriere</dt>
                  <dd className="whitespace-pre-wrap">{p.description}</dd>
                </>
              )}
            </dl>
          )}
          {edit && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                save.mutate();
              }}
              className="grid gap-3 md:grid-cols-2"
            >
              <div className="space-y-1 md:col-span-2">
                <Label>Nume</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1 md:col-span-2">
                <Label>Descriere</Label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Status</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={status}
                  onChange={(e) => setStatus(e.target.value as ProjectStatus)}
                >
                  {(['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED'] as ProjectStatus[]).map(
                    (s) => (
                      <option key={s} value={s}>{statusLabel(s)}</option>
                    ),
                  )}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Buget ({p.currency})</Label>
                <Input value={budget} onChange={(e) => setBudget(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Start</Label>
                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Finalizare</Label>
                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
              {err && <p className="md:col-span-2 text-sm text-destructive">{err}</p>}
              <div className="md:col-span-2">
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? 'Se salvează…' : 'Salvează'}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Facturi asociate</CardTitle></CardHeader>
        <CardContent>
          {invoicesQ.isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
          {invoicesQ.data && invoicesQ.data.data.length === 0 && (
            <p className="text-sm text-muted-foreground">Nicio factură.</p>
          )}
          <ul className="space-y-2">
            {invoicesQ.data?.data.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between rounded border p-2 text-sm">
                <span>{inv.series}-{String(inv.number).padStart(4, '0')}</span>
                <span>{inv.status}</span>
                <span className="font-mono">{formatMoney(inv.total, inv.currency)}</span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function statusLabel(s: ProjectStatus): string {
  return (
    {
      PLANNED: 'Planificat',
      ACTIVE: 'Activ',
      ON_HOLD: 'Pe pauză',
      COMPLETED: 'Finalizat',
      CANCELLED: 'Anulat',
    } as Record<ProjectStatus, string>
  )[s];
}

function formatMoney(amount: string, currency: InvoiceCurrency): string {
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(Number(amount));
}
