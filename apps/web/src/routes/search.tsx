import { createRoute, useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { authedRoute } from './authed';
import { searchApi } from '@/features/search/api';
import type { SearchResult } from '@/lib/types';

const searchParamsSchema = z.object({
  q: z.string().default(''),
});

export const searchRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/search',
  validateSearch: (s) => searchParamsSchema.parse(s),
  component: SearchPage,
});

function SearchPage(): JSX.Element {
  const { q } = searchRoute.useSearch();
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['search', q],
    queryFn: () => searchApi.semantic(q),
    enabled: !!q,
  });

  const results = data?.results ?? [];

  const handleClick = (r: SearchResult): void => {
    if (r.type === 'company') void navigate({ to: '/app/companies/$id', params: { id: r.id } });
    else if (r.type === 'contact') void navigate({ to: '/app/contacts/$id', params: { id: r.id } });
    else void navigate({ to: '/app/clients/$id', params: { id: r.id } });
  };

  const typeLabel: Record<SearchResult['type'], string> = {
    company: 'Companie',
    contact: 'Contact',
    client: 'Client',
  };

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-semibold">Rezultate pentru „{q}"</h1>

      {isLoading && <p className="text-sm text-muted-foreground">Se caută…</p>}

      {!isLoading && results.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Niciun rezultat semantic.{' '}
          {!q && 'Introdu un termen de căutare.'}
        </p>
      )}

      <ul className="divide-y rounded-lg border bg-background">
        {results.map((r) => (
          <li key={`${r.type}-${r.id}`}>
            <button
              type="button"
              onClick={() => handleClick(r)}
              className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div>
                  <span className="font-medium">{r.label}</span>
                  {r.subtitle && (
                    <span className="ml-2 text-sm text-muted-foreground">{r.subtitle}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs rounded-full bg-muted px-2 py-0.5">
                    {typeLabel[r.type]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {(r.score * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
