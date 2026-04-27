import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AlertTriangle, Files, Plus, Trash2 } from 'lucide-react';
import { contractsApi, type ContractStatus } from '@/features/contracts/api';
import { companiesApi } from '@/features/companies/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  ListSurface,
  PageHeader,
  StatusBadge,
  type StatusBadgeTone,
  Toolbar,
} from '@/components/ui/page-header';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Schiță',
  ACTIVE: 'Activ',
  EXPIRED: 'Expirat',
  TERMINATED: 'Terminat',
  RENEWED: 'Reînnoit',
};

const STATUS_TONES: Record<ContractStatus, StatusBadgeTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'green',
  EXPIRED: 'pink',
  TERMINATED: 'neutral',
  RENEWED: 'blue',
};

/** Returns true when endDate is within 30 calendar days from now. */
function expiresWithin30Days(endDate: string | null | undefined): boolean {
  if (!endDate) return false;
  const end = new Date(endDate).getTime();
  const now = Date.now();
  const diff = end - now;
  return diff > 0 && diff <= 30 * 24 * 60 * 60 * 1000;
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  highlight,
  sub,
}: {
  title: string;
  value: number | string;
  highlight?: boolean;
  sub?: string;
}): JSX.Element {
  return (
    <GlassCard className="p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums ${
          highlight ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </GlassCard>
  );
}

// ── New contract form ─────────────────────────────────────────────────────────

function NewContractForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [value, setValue] = useState('');
  const [currency, setCurrency] = useState('RON');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [autoRenew, setAutoRenew] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: companies } = useQuery({
    queryKey: ['companies', 'for-contract-form'],
    queryFn: () => companiesApi.list(undefined, 50, undefined),
  });

  const createMut = useMutation({
    mutationFn: () =>
      contractsApi.create({
        title,
        companyId: companyId || undefined,
        value: value || undefined,
        currency,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        autoRenew,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contracts'] });
      onDone();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Eroare la creare.');
    },
  });

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Contract nou</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          createMut.mutate();
        }}
        className="grid gap-4 md:grid-cols-2"
      >
        <div className="space-y-1.5 md:col-span-2">
          <Label htmlFor="ct-title">Titlu *</Label>
          <Input id="ct-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-company">Companie</Label>
          <select
            id="ct-company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">— alege —</option>
            {companies?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-value">Valoare</Label>
          <Input
            id="ct-value"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-currency">Monedă</Label>
          <Input
            id="ct-currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
            maxLength={3}
            className="tabular-nums"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-start">Data start</Label>
          <Input
            id="ct-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ct-end">Data expirare</Label>
          <Input
            id="ct-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <input
            id="ct-autorenew"
            type="checkbox"
            checked={autoRenew}
            onChange={(e) => setAutoRenew(e.target.checked)}
            className="rounded"
          />
          <Label htmlFor="ct-autorenew" className="cursor-pointer">
            Auto-reînnoire
          </Label>
        </div>
        <div className="md:col-span-2">
          {error && (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
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

// ── Main page ─────────────────────────────────────────────────────────────────

export function ContractsListPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<ContractStatus | ''>('');
  const [filterCompany] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['contracts', { filterStatus, filterCompany }],
    queryFn: () =>
      contractsApi.list({
        status: filterStatus || undefined,
        companyId: filterCompany || undefined,
        limit: 50,
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => contractsApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contracts'] }),
  });

  const rows = data?.data ?? [];
  const active = rows.filter((c) => c.status === 'ACTIVE');
  const expiringCount = active.filter((c) => expiresWithin30Days(c.endDate)).length;
  const totalActiveValue = active.reduce((sum, c) => sum + (c.value ? Number(c.value) : 0), 0);

  return (
    <div>
      <PageHeader
        title="Contracte"
        subtitle="Contracte active, expirate, terminate sau reînnoite. Atenție la cele care expiră în 30 de zile."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Contract nou'}
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <KpiCard title="Contracte active" value={active.length} />
        <KpiCard
          title="Expiră în 30 zile"
          value={expiringCount}
          highlight={expiringCount > 0}
        />
        <KpiCard
          title="Valoare totală active"
          value={totalActiveValue.toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' RON'}
        />
      </div>

      {showForm && <NewContractForm onDone={() => setShowForm(false)} />}

      <Toolbar>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as ContractStatus | '')}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate statusurile</option>
          {(Object.entries(STATUS_LABELS) as [ContractStatus, string][]).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
      </Toolbar>

      {isLoading && (
        <ListSurface>
          <TableSkeleton rows={6} cols={7} />
        </ListSurface>
      )}
      {isError && (
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {data && (
        <ListSurface>
          {rows.length === 0 ? (
            <EmptyState
              icon={Files}
              title={filterStatus ? 'Niciun contract pentru filtrul curent' : 'Niciun contract încă'}
              description={
                filterStatus
                  ? 'Schimbă filtrul de status pentru a vedea alte contracte.'
                  : 'Creează primul contract — pleacă din detaliul unei companii pentru a-l atașa direct.'
              }
              action={
                !filterStatus && (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Contract nou
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">Titlu</th>
                    <th scope="col" className="px-4 py-3 font-medium">Companie</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Valoare</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Data start</th>
                    <th scope="col" className="px-4 py-3 font-medium">Data expirare</th>
                    <th scope="col" className="px-4 py-3 font-medium text-center">Auto-reînnoire</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => {
                    const expiring = expiresWithin30Days(c.endDate);
                    return (
                      <tr
                        key={c.id}
                        className={`border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40 ${
                          expiring ? 'bg-accent-amber/[0.06]' : ''
                        }`}
                      >
                        <td className="px-4 py-3 font-medium">{c.title}</td>
                        <td className="px-4 py-3 text-muted-foreground">{c.company?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                          {c.value
                            ? Number(c.value).toLocaleString('ro-RO', { maximumFractionDigits: 2 }) +
                              ' ' +
                              c.currency
                            : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={STATUS_TONES[c.status]}>
                            {STATUS_LABELS[c.status]}
                          </StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                          {c.startDate ? new Date(c.startDate).toLocaleDateString('ro-RO') : '—'}
                        </td>
                        <td
                          className={`px-4 py-3 text-xs tabular-nums ${
                            expiring ? 'font-semibold text-accent-amber' : 'text-muted-foreground'
                          }`}
                        >
                          {c.endDate ? (
                            <span className="inline-flex items-center gap-1">
                              {new Date(c.endDate).toLocaleDateString('ro-RO')}
                              {expiring && <AlertTriangle size={12} />}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-center text-xs">
                          {c.autoRenew ? 'Da' : 'Nu'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={deleteMut.isPending}
                            onClick={() => {
                              if (confirm('Ștergi contractul?')) deleteMut.mutate(c.id);
                            }}
                            aria-label="Șterge contract"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ListSurface>
      )}

      {data?.nextCursor && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Există mai multe rezultate — restrânge filtrele sau implementează paginarea.
        </p>
      )}
    </div>
  );
}
