import { createRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Briefcase, Plus, Trash2 } from 'lucide-react';
import { authedRoute } from './authed';
import { projectsApi, type CreateProjectInput, type UpdateProjectInput } from '@/features/projects/api';
import { companiesApi } from '@/features/companies/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { ListSkeleton } from '@/components/ui/loading-skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  type StatusBadgeTone,
} from '@/components/ui/page-header';
import type { Project, ProjectStatus } from '@/lib/types';
import { QueryError } from '@/components/ui/QueryError';
import { useTour } from '@/lib/tours/useTour';

export const projectsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/projects',
  component: ProjectsListPage,
});

function ProjectsListPage(): JSX.Element {
  useTour('projects-list');
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
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
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)} data-tour="projects-new-btn">
            <Plus size={14} className="mr-1.5" />
            Proiect nou
          </Button>
        }
      />

      {showCreate && <NewProjectForm onDone={() => setShowCreate(false)} />}

      {isLoading && <ListSkeleton rows={5} />}
      <QueryError isError={isError} error={error} label="Nu am putut încărca proiectele." />

      {data && data.data.length === 0 && !showCreate && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={Briefcase}
            title="Niciun proiect încă"
            description={'Apasă "Proiect nou" sus pentru a crea unul, sau vor apărea automat când un deal trece la stage-ul WON.'}
          />
        </GlassCard>
      )}

      <div className="space-y-2" data-tour="projects-list">
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

function NewProjectForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState<ProjectStatus>('PLANNED');
  const [description, setDescription] = useState('');

  const companies = useQuery({
    queryKey: ['companies', 'for-project-create'],
    queryFn: () => companiesApi.list(undefined, 50),
  });

  const createMut = useMutation({
    mutationFn: (dto: CreateProjectInput) => projectsApi.create(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['projects'] });
      onDone();
    },
  });

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim() || !companyId) return;
    const dto: CreateProjectInput = {
      name: name.trim(),
      companyId,
      status,
    };
    if (description.trim()) dto.description = description.trim();
    createMut.mutate(dto);
  }

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Proiect nou</h2>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="p-name">Nume *</Label>
          <Input
            id="p-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Implementare ERP — Q1"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-company">Companie *</Label>
          <select
            id="p-company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            required
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">— alege companie —</option>
            {companies.data?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="p-status">Status</Label>
          <select
            id="p-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as ProjectStatus)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="PLANNED">Planificat</option>
            <option value="ACTIVE">Activ</option>
            <option value="ON_HOLD">Pe pauză</option>
          </select>
        </div>
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="p-description">Descriere (opțional)</Label>
          <Input
            id="p-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Detalii suplimentare"
          />
        </div>
        <div className="md:col-span-2">
          {createMut.isError && (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {createMut.error instanceof Error ? createMut.error.message : 'Eroare la salvare'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>
              Anulează
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || !companyId || createMut.isPending}
            >
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}
