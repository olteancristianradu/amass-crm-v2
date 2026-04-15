import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { authedRoute } from './authed';
import { projectsApi } from '@/features/projects/api';
import { Card, CardContent } from '@/components/ui/card';
import type { ProjectStatus } from '@/lib/types';

export const projectsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/projects',
  component: ProjectsListPage,
});

function ProjectsListPage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['projects', 'list'],
    queryFn: () => projectsApi.list({ limit: 50 }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Proiecte</h1>
      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {data && data.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Niciun proiect încă. Proiectele apar automat când un deal e marcat câștigat.
        </p>
      )}
      <div className="space-y-2">
        {data?.data.map((p) => (
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
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
