import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { duplicatesApi, type DuplicateCandidate } from '@/features/duplicates/api';
import { companiesApi } from '@/features/companies/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';

export const duplicatesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/duplicates',
  component: DuplicatesPage,
});

function DuplicatesPage(): JSX.Element {
  const [selectedCompanyId, setSelectedCompanyId] = useState('');
  const [survivors, setSurvivors] = useState<Set<string>>(new Set());
  const [victims, setVictims] = useState<Set<string>>(new Set());

  const qc = useQueryClient();

  const { data: companiesData, isLoading: companiesLoading } = useQuery({
    queryKey: ['companies', {}],
    queryFn: () => companiesApi.list(undefined, 100),
  });

  const {
    data: dupeData,
    isLoading: dupeLoading,
    isError: dupeError,
    error: dupeErr,
    refetch: findDupes,
    isFetching,
  } = useQuery({
    queryKey: ['duplicates', 'companies', selectedCompanyId],
    queryFn: () => duplicatesApi.findCompanyDuplicates(selectedCompanyId),
    enabled: false, // only run on demand
  });

  const mergeMut = useMutation({
    mutationFn: () =>
      duplicatesApi.mergeCompanies({
        survivorId: [...survivors][0],
        victimIds: [...victims],
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['companies'] });
      await qc.invalidateQueries({ queryKey: ['duplicates'] });
      setSurvivors(new Set());
      setVictims(new Set());
    },
  });

  const companies = companiesData?.data ?? [];
  const candidates: DuplicateCandidate[] = dupeData?.candidates ?? [];

  function handleFind(): void {
    if (!selectedCompanyId) return;
    void findDupes();
  }

  function toggleSurvivor(id: string): void {
    // Only one survivor at a time
    setSurvivors(new Set([id]));
    // Remove from victims if it was there
    setVictims((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  function toggleVictim(id: string): void {
    setVictims((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
        // Remove from survivor if it was there
        setSurvivors((s) => {
          const ns = new Set(s);
          ns.delete(id);
          return ns;
        });
      }
      return next;
    });
  }

  const canMerge = survivors.size === 1 && victims.size > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Duplicate Companii</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Caută duplicate</CardTitle>
        </CardHeader>
        <CardContent className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor="companySelect" className="text-sm font-medium">
              Selectează compania sursă
            </label>
            {companiesLoading ? (
              <div className="animate-pulse h-9 bg-gray-100 rounded w-full" />
            ) : (
              <select
                id="companySelect"
                value={selectedCompanyId}
                onChange={(e) => setSelectedCompanyId(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">— selectează compania —</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.vatNumber ? ` (${c.vatNumber})` : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
          <Button
            onClick={handleFind}
            disabled={!selectedCompanyId || isFetching}
          >
            {isFetching ? 'Se caută…' : 'Caută duplicate'}
          </Button>
        </CardContent>
      </Card>

      {dupeLoading && isFetching && (
        <div className="animate-pulse h-8 bg-gray-100 rounded w-full" />
      )}

      {dupeError && (
        <p className="text-red-500 text-sm">
          {dupeErr instanceof ApiError ? dupeErr.message : String(dupeErr)}
        </p>
      )}

      {dupeData && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              Candidați găsiți ({candidates.length})
            </CardTitle>
            {canMerge && (
              <Button
                variant="destructive"
                size="sm"
                disabled={mergeMut.isPending}
                onClick={() => {
                  if (
                    confirm(
                      `Fuzionezi ${victims.size} compani${victims.size === 1 ? 'e' : 'i'} în cea selectată ca supravietuitoare? Acțiunea este ireversibilă.`,
                    )
                  ) {
                    mergeMut.mutate();
                  }
                }}
              >
                {mergeMut.isPending
                  ? 'Se fuzionează…'
                  : `Fuzionează (${victims.size} victimă${victims.size !== 1 ? 'e' : ''})`}
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            {mergeMut.isError && (
              <p className="px-4 pb-2 text-sm text-destructive">
                {mergeMut.error instanceof ApiError
                  ? mergeMut.error.message
                  : 'Eroare la fuzionare'}
              </p>
            )}
            {candidates.length === 0 ? (
              <p className="px-4 py-6 text-center text-muted-foreground">
                Nu au fost găsite duplicate pentru această companie.
              </p>
            ) : (
              <>
                <p className="px-4 py-2 text-xs text-muted-foreground">
                  Selectează o companie ca <strong>supravietuitoare</strong> (datele vor fi
                  păstrate) și una sau mai multe ca <strong>victimă</strong> (vor fi șterse după
                  fuzionare).
                </p>
                <table className="w-full text-sm">
                  <thead className="border-b bg-muted/50 text-left">
                    <tr>
                      <th className="px-4 py-2 font-medium">Supravietuitor</th>
                      <th className="px-4 py-2 font-medium">Victimă</th>
                      <th className="px-4 py-2 font-medium">Similaritate</th>
                      <th className="px-4 py-2 font-medium">Nume</th>
                      <th className="px-4 py-2 font-medium">CUI</th>
                      <th className="px-4 py-2 font-medium">Oraș</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr
                        key={c.id}
                        className={`border-b last:border-0 hover:bg-muted/30 ${
                          survivors.has(c.id)
                            ? 'bg-green-50'
                            : victims.has(c.id)
                              ? 'bg-red-50'
                              : ''
                        }`}
                      >
                        <td className="px-4 py-2">
                          <input
                            type="radio"
                            name="survivor"
                            checked={survivors.has(c.id)}
                            onChange={() => toggleSurvivor(c.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="checkbox"
                            checked={victims.has(c.id)}
                            onChange={() => toggleVictim(c.id)}
                            className="rounded"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <SimilarityBar value={c.similarity} />
                        </td>
                        <td className="px-4 py-2 font-medium">{c.name}</td>
                        <td className="px-4 py-2 font-mono text-xs">{c.vatNumber ?? '—'}</td>
                        <td className="px-4 py-2">{c.city ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SimilarityBar({ value }: { value: number }): JSX.Element {
  const pct = Math.round(value * 100);
  const color =
    pct >= 90
      ? 'bg-red-500'
      : pct >= 70
        ? 'bg-orange-400'
        : pct >= 50
          ? 'bg-yellow-400'
          : 'bg-gray-300';

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-muted-foreground">{pct}%</span>
    </div>
  );
}
