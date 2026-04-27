import { createRoute, Link, useParams } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Briefcase, Pencil } from 'lucide-react';
import { authedRoute } from './authed';
import { projectsApi } from '@/features/projects/api';
import { invoicesApi } from '@/features/invoices/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { GlassCard } from '@/components/ui/glass-card';
import { DetailField, DetailFields, DetailLayout } from '@/components/ui/detail-layout';
import {
  EmptyState,
  ListSurface,
  StatusBadge,
  type StatusBadgeTone,
} from '@/components/ui/page-header';
import { ApiError } from '@/lib/api';
import type { InvoiceCurrency, ProjectStatus } from '@/lib/types';

export const projectDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/projects/$id',
  component: ProjectDetailPage,
});

const STATUS_LABELS: Record<ProjectStatus, string> = {
  PLANNED: 'Planificat',
  ACTIVE: 'Activ',
  ON_HOLD: 'Pe pauză',
  COMPLETED: 'Finalizat',
  CANCELLED: 'Anulat',
};

const STATUS_TONES: Record<ProjectStatus, StatusBadgeTone> = {
  PLANNED: 'neutral',
  ACTIVE: 'blue',
  ON_HOLD: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'neutral',
};

function ProjectDetailPage(): JSX.Element {
  const { id } = useParams({ from: '/app/projects/$id' });
  const qc = useQueryClient();
  const projectQ = useQuery({
    queryKey: ['project', id],
    queryFn: () => projectsApi.get(id),
  });

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

  if (projectQ.isLoading) return <p className="text-sm text-muted-foreground">Se încarcă…</p>;
  if (!projectQ.data) return <p className="text-sm text-muted-foreground">Proiectul nu a fost găsit.</p>;
  const p = projectQ.data;

  return (
    <DetailLayout
      title={
        <span className="inline-flex items-center gap-2">
          <Briefcase size={20} className="text-muted-foreground" />
          {p.name}
        </span>
      }
      subtitle={
        <span className="inline-flex items-center gap-2">
          <StatusBadge tone={STATUS_TONES[p.status]}>{STATUS_LABELS[p.status]}</StatusBadge>
          {p.budget && (
            <span className="tabular-nums">{formatMoney(p.budget, p.currency)}</span>
          )}
        </span>
      }
      backHref="/app/projects"
      backLabel="Proiecte"
      actions={
        <Button variant="outline" size="sm" onClick={edit ? () => setEdit(false) : openEdit}>
          {edit ? 'Anulează' : <><Pencil size={14} className="mr-1.5" />Editează</>}
        </Button>
      }
      sidebar={
        <DetailFields title="Proiect">
          <DetailField label="Status" value={STATUS_LABELS[p.status]} />
          <DetailField
            label="Companie"
            value={
              <Link
                to="/app/companies/$id"
                params={{ id: p.companyId }}
                className="font-medium underline-offset-4 hover:underline"
              >
                Vezi compania
              </Link>
            }
          />
          <DetailField label="Deal legat" value={p.dealId} copyable />
          <DetailField
            label="Start"
            value={p.startDate ? new Date(p.startDate).toLocaleDateString('ro-RO') : null}
          />
          <DetailField
            label="Finalizare"
            value={p.endDate ? new Date(p.endDate).toLocaleDateString('ro-RO') : null}
          />
          <DetailField
            label="Buget"
            value={p.budget ? formatMoney(p.budget, p.currency) : null}
          />
        </DetailFields>
      }
    >
      {!edit && p.description && (
        <GlassCard className="p-5">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Descriere
          </h3>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{p.description}</p>
        </GlassCard>
      )}

      {edit && (
        <GlassCard className="p-6">
          <h2 className="mb-4 text-lg font-medium">Editează proiectul</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
            className="grid gap-4 md:grid-cols-2"
          >
            <div className="space-y-1.5 md:col-span-2">
              <Label>Nume</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Descriere</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                value={status}
                onChange={(e) => setStatus(e.target.value as ProjectStatus)}
              >
                {(Object.entries(STATUS_LABELS) as [ProjectStatus, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Buget ({p.currency})</Label>
              <Input value={budget} onChange={(e) => setBudget(e.target.value)} className="tabular-nums" />
            </div>
            <div className="space-y-1.5">
              <Label>Start</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Finalizare</Label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            {err && (
              <p className="md:col-span-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {err}
              </p>
            )}
            <div className="md:col-span-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEdit(false)}>
                Anulează
              </Button>
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? 'Se salvează…' : 'Salvează'}
              </Button>
            </div>
          </form>
        </GlassCard>
      )}

      <ListSurface>
        <header className="border-b border-border/40 px-5 py-3">
          <h2 className="text-sm font-semibold">Facturi asociate</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {p.dealId ? 'Filtrate după deal-ul atașat' : 'Filtrate după companie'}
          </p>
        </header>
        {invoicesQ.isLoading && (
          <p className="px-5 py-4 text-sm text-muted-foreground">Se încarcă…</p>
        )}
        {invoicesQ.data && invoicesQ.data.data.length === 0 && (
          <EmptyState
            title="Nicio factură"
            description="Facturile emise pentru deal-ul/compania acestui proiect vor apărea aici."
          />
        )}
        {invoicesQ.data && invoicesQ.data.data.length > 0 && (
          <ul className="divide-y divide-border/40">
            {invoicesQ.data.data.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between px-5 py-3 text-sm">
                <span className="font-mono tabular-nums">
                  {inv.series}-{String(inv.number).padStart(4, '0')}
                </span>
                <span className="text-muted-foreground">{inv.status}</span>
                <span className="font-mono tabular-nums">{formatMoney(inv.total, inv.currency)}</span>
              </li>
            ))}
          </ul>
        )}
      </ListSurface>
    </DetailLayout>
  );
}

function formatMoney(amount: string, currency: InvoiceCurrency): string {
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(Number(amount));
}
