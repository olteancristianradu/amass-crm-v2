import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  PageHeader,
} from '@/components/ui/page-header';
import { toast } from '@/stores/toasts';

interface CallScript {
  points: string[];
}

const SUGGESTED_POINTS = [
  'A salutat și s-a prezentat (nume + companie)',
  'A întrebat motivul cererii / nevoia clientului',
  'A confirmat bugetul / intervalul de preț',
  'A explicat oferta concretă (preț, livrare, garanție)',
  'A propus un pas următor (revenire / vizionare / contract)',
];

export function SettingsCallScriptPage(): JSX.Element {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['call-scripts', 'default'],
    queryFn: () => api.get<CallScript>('/call-scripts/default'),
  });

  // `draftOverride === null` → user hasn't touched the list this session,
  // render the server state directly. Any edit replaces it with an explicit
  // local copy. Avoids the cascading-render anti-pattern of mirroring server
  // data into useState via useEffect.
  const [draftOverride, setDraftOverride] = useState<string[] | null>(null);
  const [newPoint, setNewPoint] = useState('');
  const draft = draftOverride ?? data?.points ?? [];
  const setDraft = (updater: string[] | ((d: string[]) => string[])): void => {
    setDraftOverride((prev) => {
      const base = prev ?? data?.points ?? [];
      return typeof updater === 'function' ? (updater as (d: string[]) => string[])(base) : updater;
    });
  };

  const saveMut = useMutation({
    mutationFn: (points: string[]) =>
      api.put<CallScript>('/call-scripts/default', { points }),
    onSuccess: (res) => {
      qc.setQueryData(['call-scripts', 'default'], res);
      setDraftOverride(null); // server is authoritative again
      toast('Script-ul de apel a fost salvat', `${res.points.length} puncte active`);
    },
    onError: (err: unknown) => {
      toast('Eroare la salvare', err instanceof ApiError ? err.message : 'necunoscută');
    },
  });

  function addPoint(p?: string): void {
    const value = (p ?? newPoint).trim();
    if (!value) return;
    if (draft.includes(value)) {
      toast('Punct duplicat', 'Există deja în listă.');
      return;
    }
    setDraft((d) => [...d, value]);
    setNewPoint('');
  }

  function removePoint(idx: number): void {
    setDraft((d) => d.filter((_, i) => i !== idx));
  }

  function moveUp(idx: number): void {
    if (idx === 0) return;
    setDraft((d) => {
      const next = [...d];
      [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
      return next;
    });
  }
  function moveDown(idx: number): void {
    setDraft((d) => {
      if (idx >= d.length - 1) return d;
      const next = [...d];
      [next[idx + 1], next[idx]] = [next[idx]!, next[idx + 1]!];
      return next;
    });
  }

  const hasChanges =
    !!data &&
    (draft.length !== data.points.length || draft.some((p, i) => p !== data.points[i]));

  if (isError) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Script de apel"
        subtitle="Lista de puncte pe care agentul trebuie să le atingă într-un apel. După fiecare apel înregistrat, AI evaluează cât din script a fost acoperit și afișează scorul + punctele ratate pe pagina apelului."
        actions={
          <Button
            size="sm"
            onClick={() => saveMut.mutate(draft)}
            disabled={!hasChanges || saveMut.isPending}
          >
            {saveMut.isPending ? 'Se salvează…' : 'Salvează'}
          </Button>
        }
      />

      <GlassCard className="p-4 sm:p-6">
        <div className="space-y-3">
          <Label htmlFor="cs-new">Adaugă un punct nou</Label>
          <div className="flex gap-2">
            <Input
              id="cs-new"
              value={newPoint}
              onChange={(e) => setNewPoint(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addPoint();
                }
              }}
              placeholder="ex: A întrebat bugetul"
              disabled={draft.length >= 50}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => addPoint()}
              disabled={!newPoint.trim() || draft.length >= 50}
            >
              <Plus size={14} className="mr-1.5" />
              Adaugă
            </Button>
          </div>
          {draft.length >= 50 && (
            <p className="text-xs text-amber-600">Limita de 50 de puncte a fost atinsă.</p>
          )}
        </div>

        <div className="mt-4 space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
          {!isLoading && draft.length === 0 && (
            <EmptyState
              icon={ListChecks}
              title="Niciun punct definit"
              description="Adaugă cel puțin un punct (sau folosește un șablon de mai jos) pentru ca AI să poată evalua apelurile."
            />
          )}
          {draft.length > 0 && (
            <ol className="space-y-2">
              {draft.map((p, i) => (
                <li
                  key={`${i}-${p}`}
                  className="flex items-center gap-2 rounded-md border border-border/60 bg-card/40 px-3 py-2 text-sm"
                >
                  <span className="w-6 shrink-0 text-center font-mono text-xs text-muted-foreground">
                    {i + 1}.
                  </span>
                  <span className="flex-1 min-w-0 truncate">{p}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveUp(i)}
                    disabled={i === 0}
                    aria-label="Mută în sus"
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveDown(i)}
                    disabled={i === draft.length - 1}
                    aria-label="Mută în jos"
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removePoint(i)}
                    aria-label="Șterge punctul"
                  >
                    <Trash2 size={14} />
                  </Button>
                </li>
              ))}
            </ol>
          )}
        </div>
      </GlassCard>

      {data && data.points.length === 0 && (
        <GlassCard className="p-4 sm:p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Șabloane sugerate
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Click pe un șablon ca să-l adaugi în listă.
          </p>
          <ul className="mt-3 space-y-1.5">
            {SUGGESTED_POINTS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => addPoint(s)}
                  className="w-full rounded-md border border-border/40 bg-secondary/20 px-3 py-2 text-left text-sm hover:bg-secondary/40"
                >
                  + {s}
                </button>
              </li>
            ))}
          </ul>
        </GlassCard>
      )}
    </div>
  );
}
