import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { territoriesApi } from '@/features/territories/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { QueryError } from '@/components/ui/QueryError';

export const territoriesListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/territories',
  component: TerritoriesPage,
});

function TerritoriesPage(): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [counties, setCounties] = useState('');
  const [industries, setIndustries] = useState('');
  const [userIdInputs, setUserIdInputs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const { data: territories, isError, error: queryError } = useQuery({ queryKey: ['territories'], queryFn: () => territoriesApi.list() });

  const createMut = useMutation({
    mutationFn: () => territoriesApi.create({
      name,
      counties: counties.split(',').map((s) => s.trim()).filter(Boolean),
      industries: industries.split(',').map((s) => s.trim()).filter(Boolean),
    }),
    onSuccess: async () => {
      setName(''); setCounties(''); setIndustries('');
      await qc.invalidateQueries({ queryKey: ['territories'] });
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Eroare.'),
  });

  const assignMut = useMutation({
    mutationFn: (p: { id: string; userId: string }) => territoriesApi.assign(p.id, p.userId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['territories'] }),
  });

  const unassignMut = useMutation({
    mutationFn: (p: { id: string; userId: string }) => territoriesApi.unassign(p.id, p.userId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['territories'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => territoriesApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['territories'] }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Teritorii</h1>

      <Card>
        <CardHeader><CardTitle className="text-lg">Teritoriu nou</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); setError(null); createMut.mutate(); }} className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2"><Label>Nume *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="space-y-1"><Label>Județe (comma-separated)</Label><Input value={counties} onChange={(e) => setCounties(e.target.value)} placeholder="CJ, BH, TM" /></div>
            <div className="space-y-1"><Label>Industrii (comma-separated)</Label><Input value={industries} onChange={(e) => setIndustries(e.target.value)} placeholder="IT, Retail" /></div>
            <div className="md:col-span-2">
              {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={!name || createMut.isPending}>Creează</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <QueryError isError={isError} error={queryError} label="Nu am putut încărca teritoriile." />

      <div className="space-y-3">
        {(territories ?? []).map((t) => (
          <Card key={t.id}>
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle className="text-lg">{t.name}</CardTitle>
                <p className="mt-1 text-xs text-muted-foreground">
                  Județe: {t.counties.length > 0 ? t.counties.join(', ') : '—'} · Industrii: {t.industries.length > 0 ? t.industries.join(', ') : '—'}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => { if (confirm('Ștergi teritoriul?')) deleteMut.mutate(t.id); }}>×</Button>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {t.assignments.map((a) => (
                  <span key={a.id} className="flex items-center gap-1 rounded bg-muted px-2 py-1 text-xs">
                    {a.userId}
                    <button className="text-destructive" onClick={() => unassignMut.mutate({ id: t.id, userId: a.userId })}>×</button>
                  </span>
                ))}
                <div className="flex gap-1">
                  <Input
                    placeholder="User ID"
                    className="h-7 text-xs"
                    value={userIdInputs[t.id] ?? ''}
                    onChange={(e) => setUserIdInputs((m) => ({ ...m, [t.id]: e.target.value }))}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      const uid = userIdInputs[t.id];
                      if (uid) { assignMut.mutate({ id: t.id, userId: uid }); setUserIdInputs((m) => ({ ...m, [t.id]: '' })); }
                    }}
                  >+</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {(territories ?? []).length === 0 && <p className="text-sm text-muted-foreground">Niciun teritoriu.</p>}
      </div>
    </div>
  );
}
