import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ClipboardList, Plus, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import { EmptyState, PageHeader, StatusBadge } from '@/components/ui/page-header';
import { TableSkeleton } from '@/components/ui/Skeleton';

type ApprovalTrigger = 'QUOTE_ABOVE_VALUE' | 'DISCOUNT_ABOVE_PCT';
type PolicyCurrency = 'RON' | 'EUR' | 'USD';

interface ApprovalPolicy {
  id: string;
  name: string;
  trigger: ApprovalTrigger;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

interface CreatePolicyDto {
  name: string;
  trigger: ApprovalTrigger;
  config: Record<string, unknown>;
  isActive: boolean;
}

const TRIGGER_LABELS: Record<ApprovalTrigger, string> = {
  QUOTE_ABOVE_VALUE: 'Ofertă peste valoare',
  DISCOUNT_ABOVE_PCT: 'Discount peste procent',
};

const policiesApi = {
  list: () => api.get<ApprovalPolicy[]>('/approvals/policies'),
  create: (dto: CreatePolicyDto) => api.post<ApprovalPolicy>('/approvals/policies', dto),
  toggle: (id: string, isActive: boolean) =>
    api.patch<ApprovalPolicy>(`/approvals/policies/${id}`, { isActive }),
  remove: (id: string) => api.delete<void>(`/approvals/policies/${id}`),
};

export function SettingsApprovalsPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: policies, isLoading, isError, error } = useQuery({
    queryKey: ['approval-policies'],
    queryFn: () => policiesApi.list(),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      policiesApi.toggle(id, isActive),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['approval-policies'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => policiesApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['approval-policies'] }),
  });

  function handleDelete(id: string, name: string): void {
    if (!confirm(`Ștergi politica "${name}"?`)) return;
    deleteMut.mutate(id);
  }

  function formatConfig(trigger: ApprovalTrigger, config: Record<string, unknown>): string {
    if (trigger === 'QUOTE_ABOVE_VALUE') {
      const threshold = config.threshold as number | undefined;
      const currency = config.currency as string | undefined;
      if (threshold !== undefined && currency) {
        return `Prag: ${threshold.toLocaleString('ro-RO')} ${currency}`;
      }
    }
    if (trigger === 'DISCOUNT_ABOVE_PCT') {
      const pct = config.pct as number | undefined;
      if (pct !== undefined) return `Discount peste ${pct}%`;
    }
    return JSON.stringify(config);
  }

  return (
    <div>
      <PageHeader
        title="Politici de aprobare"
        subtitle="Configurează regulile de aprobare care se declanșează automat la oferte sau discount-uri. Agenții nu pot trimite ofertele care necesită aprobare fără semnătura unui manager."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Politică nouă'}
          </Button>
        }
      />

      {showForm && (
        <NewPolicyForm
          onDone={() => {
            setShowForm(false);
            void qc.invalidateQueries({ queryKey: ['approval-policies'] });
          }}
        />
      )}

      {isLoading && (
        <GlassCard className="overflow-hidden">
          <TableSkeleton rows={3} cols={3} />
        </GlassCard>
      )}

      {isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {policies && policies.length === 0 && !showForm && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={ClipboardList}
            title="Nicio politică de aprobare"
            description="Adaugă o politică pentru a controla când agenții au nevoie de aprobare managerială înainte de a trimite ofertele."
            action={
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus size={14} className="mr-1.5" /> Politică nouă
              </Button>
            }
          />
        </GlassCard>
      )}

      {policies && policies.length > 0 && (
        <div className="space-y-2">
          {policies.map((policy) => (
            <GlassCard key={policy.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{policy.name}</p>
                    <StatusBadge tone={policy.isActive ? 'green' : 'neutral'}>
                      {policy.isActive ? 'Activă' : 'Inactivă'}
                    </StatusBadge>
                    <StatusBadge tone="blue">
                      {TRIGGER_LABELS[policy.trigger] ?? policy.trigger}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatConfig(policy.trigger, policy.config)}
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    Creată la {new Date(policy.createdAt).toLocaleDateString('ro-RO')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggleMut.isPending}
                    onClick={() => toggleMut.mutate({ id: policy.id, isActive: !policy.isActive })}
                  >
                    {policy.isActive ? 'Dezactivează' : 'Activează'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMut.isPending}
                    onClick={() => handleDelete(policy.id, policy.name)}
                    aria-label="Șterge politică"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

function NewPolicyForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState<ApprovalTrigger>('QUOTE_ABOVE_VALUE');
  const [threshold, setThreshold] = useState('5000');
  const [currency, setCurrency] = useState<PolicyCurrency>('EUR');
  const [discountPct, setDiscountPct] = useState('15');
  const [formError, setFormError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (dto: CreatePolicyDto) => policiesApi.create(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approval-policies'] });
      onDone();
    },
    onError: (err: unknown) => {
      setFormError(err instanceof ApiError ? err.message : 'Eroare la creare');
    },
  });

  function buildConfig(): Record<string, unknown> {
    if (trigger === 'QUOTE_ABOVE_VALUE') {
      return { threshold: parseFloat(threshold), currency };
    }
    return { pct: parseFloat(discountPct) };
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setFormError(null);
    if (!name.trim()) {
      setFormError('Numele politicii este obligatoriu.');
      return;
    }
    if (trigger === 'QUOTE_ABOVE_VALUE') {
      const val = parseFloat(threshold);
      if (isNaN(val) || val <= 0) {
        setFormError('Pragul trebuie să fie un număr pozitiv.');
        return;
      }
    }
    if (trigger === 'DISCOUNT_ABOVE_PCT') {
      const val = parseFloat(discountPct);
      if (isNaN(val) || val <= 0 || val > 100) {
        setFormError('Procentul trebuie să fie între 1 și 100.');
        return;
      }
    }
    createMut.mutate({ name: name.trim(), trigger, config: buildConfig(), isActive: true });
  }

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Politică nouă</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="policy-name">Nume *</Label>
          <Input
            id="policy-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ex. Aprobare oferte > 5.000 EUR"
            required
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="policy-trigger">Tip declanșator *</Label>
          <select
            id="policy-trigger"
            value={trigger}
            onChange={(e) => setTrigger(e.target.value as ApprovalTrigger)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="QUOTE_ABOVE_VALUE">Ofertă peste valoare (sumă totală)</option>
            <option value="DISCOUNT_ABOVE_PCT">Discount peste procent</option>
          </select>
        </div>

        {trigger === 'QUOTE_ABOVE_VALUE' && (
          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="policy-threshold">Prag valoare *</Label>
              <Input
                id="policy-threshold"
                type="number"
                min="1"
                step="any"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <div className="w-28 space-y-1.5">
              <Label htmlFor="policy-currency">Monedă</Label>
              <select
                id="policy-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as PolicyCurrency)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="EUR">EUR</option>
                <option value="RON">RON</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </div>
        )}

        {trigger === 'DISCOUNT_ABOVE_PCT' && (
          <div className="space-y-1.5">
            <Label htmlFor="policy-discount-pct">Procent maxim discount (%) *</Label>
            <Input
              id="policy-discount-pct"
              type="number"
              min="1"
              max="100"
              step="any"
              value={discountPct}
              onChange={(e) => setDiscountPct(e.target.value)}
              className="tabular-nums"
            />
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          {trigger === 'QUOTE_ABOVE_VALUE'
            ? `Orice ofertă cu valoarea totală peste ${parseFloat(threshold) > 0 ? parseFloat(threshold).toLocaleString('ro-RO') : '—'} ${currency} va necesita aprobarea unui manager înainte de trimitere.`
            : `Orice ofertă cu discount peste ${discountPct}% va necesita aprobarea unui manager înainte de trimitere.`}
        </p>

        {formError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Anulează
          </Button>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Se salvează…' : 'Salvează politica'}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}
