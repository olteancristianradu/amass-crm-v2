import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, ClipboardList, Plus, Trash2 } from 'lucide-react';
import { authedRoute } from './authed';
import { casesApi, type CaseStatus, type CasePriority } from '@/features/cases/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  ListSurface,
  PageHeader,
  StatusBadge,
  type StatusBadgeTone,
  Toolbar,
} from '@/components/ui/page-header';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const casesListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/cases',
  component: CasesListPage,
});

const STATUS_LABELS: Record<CaseStatus, string> = {
  NEW: 'Nou',
  OPEN: 'Deschis',
  PENDING: 'În așteptare',
  RESOLVED: 'Rezolvat',
  CLOSED: 'Închis',
};

const STATUS_TONES: Record<CaseStatus, StatusBadgeTone> = {
  NEW: 'blue',
  OPEN: 'amber',
  PENDING: 'amber',
  RESOLVED: 'green',
  CLOSED: 'neutral',
};

const PRIORITY_LABELS: Record<CasePriority, string> = {
  LOW: 'Scăzută',
  NORMAL: 'Normală',
  HIGH: 'Înaltă',
  URGENT: 'Urgentă',
};

const PRIORITY_TONES: Record<CasePriority, StatusBadgeTone> = {
  LOW: 'neutral',
  NORMAL: 'neutral',
  HIGH: 'amber',
  URGENT: 'pink',
};

function isSlaBreached(slaDeadline: string | null | undefined, status: CaseStatus): boolean {
  if (!slaDeadline) return false;
  if (status === 'RESOLVED' || status === 'CLOSED') return false;
  return new Date(slaDeadline).getTime() < Date.now();
}

function NewCaseForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CasePriority>('NORMAL');
  const [slaDeadline, setSlaDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      casesApi.create({
        subject,
        description: description || undefined,
        priority,
        slaDeadline: slaDeadline || undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['cases'] });
      onDone();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Eroare la creare.');
    },
  });

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Tichet nou</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mut.mutate();
        }}
        className="grid gap-4 md:grid-cols-2"
      >
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="case-subject">Subiect *</Label>
          <Input
            id="case-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="case-description">Descriere</Label>
          <textarea
            id="case-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="case-priority">Prioritate</Label>
          <select
            id="case-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as CasePriority)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {(Object.entries(PRIORITY_LABELS) as [CasePriority, string][]).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="case-sla">SLA deadline</Label>
          <Input
            id="case-sla"
            type="datetime-local"
            value={slaDeadline}
            onChange={(e) => setSlaDeadline(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          {error && (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>
              Anulează
            </Button>
            <Button type="submit" disabled={mut.isPending || !subject.trim()}>
              {mut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}

function CasesListPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<CaseStatus | ''>('');
  const [filterPriority, setFilterPriority] = useState<CasePriority | ''>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cases', { filterStatus, filterPriority }],
    queryFn: () =>
      casesApi.list({
        status: filterStatus || undefined,
        priority: filterPriority || undefined,
        limit: 50,
      }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CaseStatus }) =>
      casesApi.update(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cases'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => casesApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cases'] }),
  });

  const rows = data?.data ?? [];
  const open = rows.filter((c) => c.status !== 'RESOLVED' && c.status !== 'CLOSED');
  const breached = open.filter((c) => isSlaBreached(c.slaDeadline, c.status)).length;
  const urgent = open.filter((c) => c.priority === 'URGENT').length;

  return (
    <div>
      <PageHeader
        title="Tichete suport"
        subtitle="Cereri și incidente raportate de clienți. Atenție la SLA-urile depășite."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Tichet nou'}
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <KpiCard title="Tichete deschise" value={open.length} />
        <KpiCard title="SLA depășit" value={breached} highlight={breached > 0} />
        <KpiCard title="Urgente" value={urgent} />
      </div>

      {showForm && <NewCaseForm onDone={() => setShowForm(false)} />}

      <Toolbar>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as CaseStatus | '')}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate statusurile</option>
          {(Object.entries(STATUS_LABELS) as [CaseStatus, string][]).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as CasePriority | '')}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate prioritățile</option>
          {(Object.entries(PRIORITY_LABELS) as [CasePriority, string][]).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
      </Toolbar>

      {isLoading && (
        <ListSurface>
          <TableSkeleton rows={6} cols={6} />
        </ListSurface>
      )}
      {isError && (
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {data && (
        <ListSurface>
          {rows.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={filterStatus || filterPriority ? 'Niciun tichet pentru filtrul curent' : 'Niciun tichet încă'}
              description={
                filterStatus || filterPriority
                  ? 'Schimbă sau elimină filtrele pentru a vedea alte tichete.'
                  : 'Tichetele apar când clienții raportează probleme prin email/portal sau când le creezi manual.'
              }
              action={
                !filterStatus && !filterPriority && (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Tichet nou
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">#</th>
                    <th scope="col" className="px-4 py-3 font-medium">Subiect</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Prioritate</th>
                    <th scope="col" className="px-4 py-3 font-medium">SLA</th>
                    <th scope="col" className="px-4 py-3 font-medium">Creat</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const slaBreach = isSlaBreached(c.slaDeadline, c.status);
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40 ${
                          slaBreach ? 'bg-destructive/[0.04]' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-mono text-xs tabular-nums">#{c.number}</td>
                        <td className="px-4 py-3 font-medium">{c.subject}</td>
                        <td className="px-4 py-3">
                          <select
                            value={c.status}
                            onChange={(e) =>
                              updateMut.mutate({
                                id: c.id,
                                status: e.target.value as CaseStatus,
                              })
                            }
                            className="rounded-md border border-input bg-background px-2 py-0.5 text-xs"
                          >
                            {(Object.entries(STATUS_LABELS) as [CaseStatus, string][]).map(
                              ([val, label]) => (
                                <option key={val} value={val}>
                                  {label}
                                </option>
                              ),
                            )}
                          </select>{' '}
                          <span className="ml-1 inline-block">
                            <StatusBadge tone={STATUS_TONES[c.status]}>
                              {STATUS_LABELS[c.status]}
                            </StatusBadge>
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={PRIORITY_TONES[c.priority]}>
                            {PRIORITY_LABELS[c.priority]}
                          </StatusBadge>
                        </td>
                        <td
                          className={`px-4 py-3 text-xs tabular-nums ${
                            slaBreach ? 'font-semibold text-destructive' : 'text-muted-foreground'
                          }`}
                        >
                          {c.slaDeadline ? (
                            <span className="inline-flex items-center gap-1">
                              {new Date(c.slaDeadline).toLocaleString('ro-RO')}
                              {slaBreach && <AlertTriangle size={12} />}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                          {new Date(c.createdAt).toLocaleDateString('ro-RO')}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={deleteMut.isPending}
                            onClick={() => {
                              if (confirm('Ștergi tichetul?')) deleteMut.mutate(c.id);
                            }}
                            aria-label="Șterge tichet"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ListSurface>
      )}
    </div>
  );
}

function KpiCard({
  title,
  value,
  highlight,
}: {
  title: string;
  value: number;
  highlight?: boolean;
}): JSX.Element {
  return (
    <GlassCard className="p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums ${
          highlight ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </GlassCard>
  );
}
