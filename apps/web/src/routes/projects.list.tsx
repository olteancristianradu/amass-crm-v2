import { createRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Briefcase, Trash2 } from 'lucide-react';
import { authedRoute } from './authed';
import { projectsApi, type UpdateProjectInput } from '@/features/projects/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  type StatusBadgeTone,
} from '@/components/ui/page-header';
import type { Project, ProjectStatus } from '@/lib/types';
import { QueryError } from '@/components/ui/QueryError';

export const projectsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/projects',
  component: ProjectsListPage,
});

function ProjectsListPage(): JSX.Element {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['projects', 'list'],
    queryFn: () => projectsApi.list({ limit: 50 }),
  });

  const [editingId, setEditingId] = useState<string | null>(null);

  const deleteMut = useMutation({
    mutationFn: (id: string) => projectsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', 'list'] }),
  });

  function handleDelete(p: Project): void {
    if (!window.confirm(`Ștergi proiectul "${p.name}"? Acțiunea este ireversibilă.`)) return;
    deleteMut.mutate(p.id);
  }

  return (
    <div>
      <PageHeader
        title="Proiecte"
        subtitle="Proiectele apar automat când un deal e marcat câștigat — sau le poți crea manual."
      />

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={isError} error={error} label="Nu am putut încărca proiectele." />

      {data && data.data.length === 0 && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={Briefcase}
            title="Niciun proiect încă"
            description="Proiectele apar automat când un deal trece la stage-ul WON. Dacă faci kickoff-ul direct dintr-o ofertă semnată, treci deal-ul prin pipeline."
          />
        </GlassCard>
      )}

      <div className="space-y-2">
        {data?.data.map((p) =>
          editingId === p.id ? (
            <EditProjectCard key={p.id} project={p} onDone={() => setEditingId(null)} />
          ) : (
            <GlassCard key={p.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to="/app/companies/$id"
                    params={{ id: p.companyId }}
                    className="font-medium text-foreground underline-offset-4 hover:underline"
                  >
                    {p.name}
                  </Link>
                  {p.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                    {p.startDate ? new Date(p.startDate).toLocaleDateString('ro-RO') : '—'}
                    {' → '}
                    {p.endDate ? new Date(p.endDate).toLocaleDateString('ro-RO') : '—'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {p.budget && (
                    <span className="font-mono text-sm tabular-nums">
                      {formatMoney(p.budget, p.currency)}
                    </span>
                  )}
                  <StatusBadge tone={STATUS_TONES[p.status]}>{STATUS_LABELS[p.status]}</StatusBadge>
                  <Button variant="outline" size="sm" onClick={() => setEditingId(p.id)}>
                    Editează
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMut.isPending}
                    onClick={() => handleDelete(p)}
                    aria-label="Șterge proiect"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </GlassCard>
          ),
        )}
      </div>
    </div>
  );
}

function EditProjectCard({
  project,
  onDone,
}: {
  project: Project;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState(project.name);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [description, setDescription] = useState(project.description ?? '');
  const [error, setError] = useState('');

  const updateMut = useMutation({
    mutationFn: (dto: UpdateProjectInput) => projectsApi.update(project.id, dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['projects', 'list'] });
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim()) {
      setError('Numele este obligatoriu.');
      return;
    }
    updateMut.mutate({ name: name.trim(), status, description: description || null });
  }

  return (
    <GlassCard className="border-primary/40 px-4 py-3">
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Nume</label>
          <input
            className="flex h-9 w-48 rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Status</label>
          <select
            className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
          >
            <option value="PLANNED">Planificat</option>
            <option value="ACTIVE">Activ</option>
            <option value="ON_HOLD">Pe pauză</option>
            <option value="COMPLETED">Finalizat</option>
            <option value="CANCELLED">Anulat</option>
          </select>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Descriere</label>
          <input
            className="flex h-9 w-full rounded-md border border-input bg-background px-2 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Opțional"
          />
        </div>
        {error && (
          <p className="w-full rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={updateMut.isPending}>
            {updateMut.isPending ? 'Se salvează…' : 'Salvează'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onDone}>
            Anulează
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

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

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(n);
}
