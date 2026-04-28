import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ArrowLeft, ArrowRight, KanbanSquare, Plus, Trash2 } from 'lucide-react';
import { pipelinesApi } from '@/features/pipelines/api';
import { dealsApi } from '@/features/deals/api';
import { companiesApi } from '@/features/companies/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { GlassCard, StatusDot, type StatusTone } from '@/components/ui/glass-card';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { ApiError } from '@/lib/api';
import type { Deal, Pipeline, PipelineStage } from '@/lib/types';

/** Map a pipeline stage type to a status-dot tone for the column header. */
const STAGE_TONE: Record<PipelineStage['type'], StatusTone> = {
  OPEN: 'blue',
  WON: 'green',
  LOST: 'pink',
};

export function DealsKanbanPage(): JSX.Element {
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
    mutationFn: ({
      id,
      stageId,
      lostReason,
    }: {
      id: string;
      stageId: string;
      lostReason?: string;
    }) => dealsApi.move(id, { stageId, lostReason }),
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
    return (
      <GlassCard className="overflow-hidden">
        <EmptyState
          icon={KanbanSquare}
          title="Niciun pipeline configurat"
          description="Creează un pipeline din setări înainte de a putea adăuga deal-uri."
        />
      </GlassCard>
    );
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

  // Stage value totals for the column header (sum of OPEN deals only;
  // WON/LOST columns show the count).
  const stageValueRO = (stage: PipelineStage, list: Deal[]): string => {
    if (stage.type !== 'OPEN') return '';
    const sum = list.reduce((s, d) => s + (d.value ? Number(d.value) : 0), 0);
    if (sum === 0) return '';
    return new Intl.NumberFormat('ro-RO', {
      style: 'currency',
      currency: list[0]?.currency ?? 'RON',
      maximumFractionDigits: 0,
    }).format(sum);
  };

  return (
    <div>
      <PageHeader
        title={pipeline.name}
        subtitle={pipeline.description ?? 'Pipeline implicit'}
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Deal nou'}
          </Button>
        }
      />

      {showForm && <NewDealForm pipeline={pipeline} onDone={() => setShowForm(false)} />}

      <div
        className="grid gap-3 overflow-x-auto pb-2"
        style={{
          gridTemplateColumns: `repeat(${pipeline.stages.length}, minmax(260px, 1fr))`,
        }}
      >
        {pipeline.stages.map((stage) => {
          const stageDeals = dealsByStage.get(stage.id) ?? [];
          const total = stageValueRO(stage, stageDeals);
          return (
            <GlassCard key={stage.id} className="flex min-h-[200px] flex-col p-3">
              <div className="mb-3 flex items-baseline justify-between gap-2 px-1">
                <div className="flex min-w-0 items-center gap-2">
                  <StatusDot tone={STAGE_TONE[stage.type]} />
                  <h3 className="truncate text-sm font-semibold">{stage.name}</h3>
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {stageDeals.length}
                </span>
              </div>
              {total && (
                <p className="mb-2 px-1 text-xs tabular-nums text-muted-foreground">{total}</p>
              )}
              <div className="dense-gap-y space-y-2">
                {stageDeals.length === 0 ? (
                  <p className="px-1 py-3 text-center text-xs text-muted-foreground/70">—</p>
                ) : (
                  stageDeals.map((deal) => (
                    <DealCard
                      key={deal.id}
                      deal={deal}
                      stages={pipeline.stages}
                      onMove={(target) => handleMove(deal, target)}
                      onDelete={() => removeMut.mutate(deal.id)}
                      pending={moveMut.isPending || removeMut.isPending}
                    />
                  ))
                )}
              </div>
            </GlassCard>
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
  const nextStage =
    currentIdx >= 0 && currentIdx < stages.length - 1 ? stages[currentIdx + 1] : null;

  return (
    <div className="rounded-md border border-border/70 bg-card/80 p-3 backdrop-blur-sm transition-shadow hover:shadow-glass">
      <p className="text-sm font-medium leading-tight">{deal.title}</p>
      {deal.value && (
        <p className="mt-1 text-xs tabular-nums text-muted-foreground">
          {formatMoney(deal.value, deal.currency)}
        </p>
      )}
      {deal.expectedCloseAt && (
        <p className="text-xs tabular-nums text-muted-foreground">
          {new Date(deal.expectedCloseAt).toLocaleDateString('ro-RO')}
        </p>
      )}
      {deal.status !== 'OPEN' && (
        <p className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {deal.status === 'WON' ? '✓ Câștigat' : '✗ Pierdut'}
        </p>
      )}
      <div className="mt-2 flex items-center justify-between gap-1 border-t border-border/50 pt-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={!prevStage || pending}
          onClick={() => prevStage && onMove(prevStage)}
          title={prevStage ? `Mutare la ${prevStage.name}` : undefined}
          aria-label="Mutare la stage anterior"
        >
          <ArrowLeft size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!nextStage || pending}
          onClick={() => nextStage && onMove(nextStage)}
          title={nextStage ? `Mutare la ${nextStage.name}` : undefined}
          aria-label="Mutare la stage următor"
        >
          <ArrowRight size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={onDelete}
          title="Șterge"
          aria-label="Șterge deal"
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
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
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Deal nou</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMut.mutate();
        }}
        className="grid gap-4 md:grid-cols-2"
      >
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="deal-title">Titlu *</Label>
          <Input
            id="deal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-stage">Etapă</Label>
          <select
            id="deal-stage"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
        <div className="space-y-1.5">
          <Label htmlFor="deal-company">Companie</Label>
          <select
            id="deal-company"
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
        <div className="space-y-1.5">
          <Label htmlFor="deal-value">Valoare</Label>
          <Input
            id="deal-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="12500.00"
            inputMode="decimal"
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deal-currency">Monedă</Label>
          <Input
            id="deal-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5 md:col-span-2">
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
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {createMut.error instanceof ApiError ? createMut.error.message : 'Eroare'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>
              Anulează
            </Button>
            <Button type="submit" disabled={createMut.isPending || !title.trim()}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}
