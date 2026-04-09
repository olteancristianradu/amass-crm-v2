import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { pipelinesApi } from '@/features/pipelines/api';
import { dealsApi } from '@/features/deals/api';
import { companiesApi } from '@/features/companies/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import type { Deal, Pipeline, PipelineStage } from '@/lib/types';

export const dealsKanbanRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/deals',
  component: DealsKanbanPage,
});

function DealsKanbanPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: pipelines, isLoading: loadingPipelines } = useQuery({
    queryKey: ['pipelines'],
    queryFn: () => pipelinesApi.list(),
  });

  // S10 ships with one default pipeline per tenant. Picking between
  // multiple pipelines is a post-S10 feature.
  const pipeline = pipelines?.[0];

  const { data: deals, isLoading: loadingDeals } = useQuery({
    queryKey: ['deals', { pipelineId: pipeline?.id }],
    queryFn: () => dealsApi.list({ pipelineId: pipeline!.id, limit: 200 }),
    enabled: !!pipeline?.id,
  });

  const moveMut = useMutation({
    mutationFn: ({ id, stageId, lostReason }: { id: string; stageId: string; lostReason?: string }) =>
      dealsApi.move(id, { stageId, lostReason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => dealsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deals'] }),
  });

  if (loadingPipelines || loadingDeals) {
    return <p className="text-sm text-muted-foreground">Se încarcă…</p>;
  }
  if (!pipeline) {
    return <p className="text-sm text-destructive">Niciun pipeline configurat.</p>;
  }

  const dealsByStage = new Map<string, Deal[]>();
  for (const stage of pipeline.stages) dealsByStage.set(stage.id, []);
  for (const deal of deals?.data ?? []) {
    const bucket = dealsByStage.get(deal.stageId);
    if (bucket) bucket.push(deal);
  }

  const handleMove = (deal: Deal, targetStage: PipelineStage): void => {
    if (targetStage.type === 'LOST') {
      const reason = window.prompt('Motiv pentru pierdere?');
      if (!reason) return;
      moveMut.mutate({ id: deal.id, stageId: targetStage.id, lostReason: reason });
      return;
    }
    moveMut.mutate({ id: deal.id, stageId: targetStage.id });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{pipeline.name}</h1>
          <p className="text-sm text-muted-foreground">
            {pipeline.description ?? 'Pipeline implicit'}
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Deal nou'}
        </Button>
      </div>

      {showForm && (
        <NewDealForm pipeline={pipeline} onDone={() => setShowForm(false)} />
      )}

      <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${pipeline.stages.length}, minmax(240px, 1fr))` }}>
        {pipeline.stages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          return (
            <div key={stage.id} className="rounded-md border bg-muted/20 p-2">
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h3 className="text-sm font-semibold">{stage.name}</h3>
                <span className="text-xs text-muted-foreground">{stageDeals.length}</span>
              </div>
              <div className="space-y-2">
                {stageDeals.map((deal) => (
                  <DealCard
                    key={deal.id}
                    deal={deal}
                    stages={pipeline.stages}
                    onMove={(target) => handleMove(deal, target)}
                    onDelete={() => removeMut.mutate(deal.id)}
                    pending={moveMut.isPending || removeMut.isPending}
                  />
                ))}
                {stageDeals.length === 0 && (
                  <p className="px-1 text-xs text-muted-foreground">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DealCardProps {
  deal: Deal;
  stages: PipelineStage[];
  onMove: (target: PipelineStage) => void;
  onDelete: () => void;
  pending: boolean;
}

function DealCard({ deal, stages, onMove, onDelete, pending }: DealCardProps): JSX.Element {
  const currentIdx = stages.findIndex((s) => s.id === deal.stageId);
  const prevStage = currentIdx > 0 ? stages[currentIdx - 1] : null;
  const nextStage = currentIdx >= 0 && currentIdx < stages.length - 1 ? stages[currentIdx + 1] : null;

  return (
    <Card>
      <CardContent className="space-y-2 p-3">
        <p className="text-sm font-medium leading-tight">{deal.title}</p>
        {deal.value && (
          <p className="text-xs text-muted-foreground">
            {formatMoney(deal.value, deal.currency)}
          </p>
        )}
        {deal.expectedCloseAt && (
          <p className="text-xs text-muted-foreground">
            {new Date(deal.expectedCloseAt).toLocaleDateString('ro-RO')}
          </p>
        )}
        {deal.status !== 'OPEN' && (
          <p className="text-xs font-medium uppercase text-muted-foreground">
            {deal.status === 'WON' ? 'Câștigat' : 'Pierdut'}
          </p>
        )}
        <div className="flex items-center justify-between gap-1 pt-1">
          <Button
            size="sm"
            variant="ghost"
            disabled={!prevStage || pending}
            onClick={() => prevStage && onMove(prevStage)}
            title={prevStage ? `Mutare la ${prevStage.name}` : undefined}
          >
            ←
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!nextStage || pending}
            onClick={() => nextStage && onMove(nextStage)}
            title={nextStage ? `Mutare la ${nextStage.name}` : undefined}
          >
            →
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={onDelete}
            title="Șterge"
          >
            ×
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function formatMoney(value: string, currency: string): string {
  try {
    const n = Number.parseFloat(value);
    return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(n);
  } catch {
    return `${value} ${currency}`;
  }
}

interface NewDealFormProps {
  pipeline: Pipeline;
  onDone: () => void;
}

function NewDealForm({ pipeline, onDone }: NewDealFormProps): JSX.Element {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('RON');
  const [description, setDescription] = useState('');
  const [stageId, setStageId] = useState(
    pipeline.stages.find((s) => s.type === 'OPEN')?.id ?? pipeline.stages[0].id,
  );
  const [companyId, setCompanyId] = useState<string>('');

  // Fetch companies for the company picker. We load the first page (50)
  // and trust the user to type the full name for now — full async-select
  // lands later.
  const { data: companies } = useQuery({
    queryKey: ['companies', 'for-deal-form'],
    queryFn: () => companiesApi.list(undefined, 50, undefined),
  });

  const createMut = useMutation({
    mutationFn: () =>
      dealsApi.create({
        pipelineId: pipeline.id,
        stageId,
        title,
        description: description || undefined,
        value: value || undefined,
        currency,
        companyId: companyId || undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['deals'] });
      setTitle('');
      setValue('');
      setDescription('');
      setCompanyId('');
      onDone();
    },
  });

  return (
    <Card>
      <CardContent className="p-4">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="deal-title">Titlu *</Label>
            <Input
              id="deal-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="deal-stage">Etapă</Label>
            <select
              id="deal-stage"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={stageId}
              onChange={(e) => setStageId(e.target.value)}
            >
              {pipeline.stages
                .filter((s) => s.type === 'OPEN')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="deal-company">Companie</Label>
            <select
              id="deal-company"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
            >
              <option value="">— fără —</option>
              {companies?.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="deal-value">Valoare</Label>
            <Input
              id="deal-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="12500.00"
              inputMode="decimal"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="deal-currency">Monedă</Label>
            <Input
              id="deal-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="deal-desc">Descriere</Label>
            <Textarea
              id="deal-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          <div className="md:col-span-2">
            {createMut.isError && (
              <p className="mb-2 text-sm text-destructive">
                {createMut.error instanceof ApiError ? createMut.error.message : 'Eroare'}
              </p>
            )}
            <Button type="submit" disabled={createMut.isPending || !title.trim()}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
