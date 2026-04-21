import { useQuery } from '@tanstack/react-query';
import { dealsApi } from './api';
import { pipelinesApi } from '@/features/pipelines/api';

interface Props {
  companyId: string;
}

/**
 * Read-only list of deals linked to a company, shown on the company
 * detail page. Full editing happens on /app/deals (the kanban).
 *
 * We join stage names client-side by pre-fetching pipelines — the
 * /deals response doesn't include stages (keeping it cheap for the
 * kanban's bulk query).
 */
export function DealsTab({ companyId }: Props): JSX.Element {
  const { data: pipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list(),
  });
  const { data: deals, isLoading } = useQuery({
    queryKey: ['deals', { companyId }],
    queryFn: () => dealsApi.list({ companyId, limit: 100 }),
  });

  const stageName = (stageId: string): string => {
    for (const p of pipelines ?? []) {
      const s = p.stages.find((x) => x.id === stageId);
      if (s) return s.name;
    }
    return '—';
  };

  if (isLoading) return <p className="pt-4 text-sm text-muted-foreground">Se încarcă…</p>;
  if (!deals || deals.data.length === 0) {
    return <p className="pt-4 text-sm text-muted-foreground">Niciun deal.</p>;
  }

  return (
    <div className="pt-4">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="py-2">Titlu</th>
            <th scope="col" className="py-2">Etapă</th>
            <th scope="col" className="py-2">Valoare</th>
            <th scope="col" className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {deals.data.map((d) => (
            <tr key={d.id} className="border-b last:border-0">
              <td className="py-2 font-medium">{d.title}</td>
              <td className="py-2">{stageName(d.stageId)}</td>
              <td className="py-2">
                {d.value ? `${d.value} ${d.currency}` : '—'}
              </td>
              <td className="py-2">
                <span className={statusBadgeClass(d.status)}>{statusLabel(d.status)}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function statusLabel(s: 'OPEN' | 'WON' | 'LOST'): string {
  switch (s) {
    case 'OPEN':
      return 'Deschis';
    case 'WON':
      return 'Câștigat';
    case 'LOST':
      return 'Pierdut';
  }
}

function statusBadgeClass(s: 'OPEN' | 'WON' | 'LOST'): string {
  const base = 'rounded-sm px-2 py-0.5 text-xs font-medium';
  switch (s) {
    case 'OPEN':
      return `${base} bg-secondary text-foreground`;
    case 'WON':
      return `${base} bg-primary/10 text-primary`;
    case 'LOST':
      return `${base} bg-destructive/10 text-destructive`;
  }
}
