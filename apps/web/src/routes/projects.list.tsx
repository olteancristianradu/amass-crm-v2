import { createRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { projectsApi, type UpdateProjectInput } from '@/features/projects/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Proiecte</h1>
      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={isError} error={error} label="Nu am putut încărca proiectele." />
      {data && data.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Niciun proiect încă. Proiectele apar automat când un deal e marcat câștigat.
        </p>
      )}
      <div className="space-y-2">
        {data?.data.map((p) =>
          editingId === p.id ? (
            <EditProjectCard
              key={p.id}
              project={p}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <Card key={p.id}>
              <CardContent className="flex items-center justify-between py-3">
                <div>
                  <Link
                    to="/app/companies/$id"
                    params={{ id: p.companyId }}
                    className="font-medium hover:underline"
                  >
                    {p.name}
                  </Link>
                  {p.description && (
                    <p className="text-xs text-muted-foreground">{p.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {p.startDate ? new Date(p.startDate).toLocaleDateString('ro-RO') : '—'}
                    {' → '}
                    {p.endDate ? new Date(p.endDate).toLocaleDateString('ro-RO') : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {p.budget && (
                    <span className="font-mono text-sm">
                      {formatMoney(p.budget, p.currency)}
                    </span>
                  )}
                  <StatusBadge status={p.status} />
                  <Button variant="outline" size="sm" onClick={() => setEditingId(p.id)}>
                    Editează
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={deleteMut.isPending}
                    onClick={() => handleDelete(p)}
                  >
                    Șterge
                  </Button>
                </div>
              </CardContent>
            </Card>
          )
        )}
      </div>
    </div>
  );
}

function EditProjectCard({ project, onDone }: { project: Project; onDone: () => void }): JSX.Element {
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
    if (!name.trim()) { setError('Numele este obligatoriu.'); return; }
    updateMut.mutate({ name: name.trim(), status, description: description || null });
  }

  return (
    <Card className="border-primary/40 bg-muted/30">
      <CardContent className="py-3">
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Nume</label>
            <input
              className="rounded border border-input px-2 py-1 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Status</label>
            <select
              className="rounded border border-input px-2 py-1 text-sm"
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
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Descriere</label>
            <input
              className="rounded border border-input px-2 py-1 text-sm"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opțional"
            />
          </div>
          {error && <p className="w-full text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={updateMut.isPending}>
              {updateMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={onDone}>
              Anulează
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: ProjectStatus }): JSX.Element {
  const cls: Record<ProjectStatus, string> = {
    PLANNED: 'bg-gray-100 text-gray-700',
    ACTIVE: 'bg-blue-100 text-blue-800',
    ON_HOLD: 'bg-amber-100 text-amber-800',
    COMPLETED: 'bg-green-100 text-green-800',
    CANCELLED: 'bg-gray-200 text-gray-500',
  };
  const labels: Record<ProjectStatus, string> = {
    PLANNED: 'Planificat',
    ACTIVE: 'Activ',
    ON_HOLD: 'Pe pauză',
    COMPLETED: 'Finalizat',
    CANCELLED: 'Anulat',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls[status]}`}>
      {labels[status]}
    </span>
  );
}

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(n);
}
