import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { contractsApi, type ContractStatus } from '@/features/contracts/api';
import { companiesApi } from '@/features/companies/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const contractsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/contracts',
  component: ContractsListPage,
});

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ContractStatus, string> = {
  DRAFT: 'Schiță',
  ACTIVE: 'Activ',
  EXPIRED: 'Expirat',
  TERMINATED: 'Terminat',
  RENEWED: 'Reînnoit',
};

const STATUS_CLASSES: Record<ContractStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-600',
  ACTIVE: 'bg-green-100 text-green-800',
  EXPIRED: 'bg-red-100 text-red-800',
  TERMINATED: 'bg-gray-900 text-white',
  RENEWED: 'bg-blue-100 text-blue-800',
};

function StatusBadge({ status }: { status: ContractStatus }): JSX.Element {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

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
    <Card className={highlight ? 'border-red-300' : undefined}>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${highlight ? 'text-red-600' : ''}`}>{value}</div>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Contract nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            createMut.mutate();
          }}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="ct-title">Titlu *</Label>
            <Input
              id="ct-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-company">Companie</Label>
            <select
              id="ct-company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="">— fără —</option>
              {companies?.data.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-value">Valoare</Label>
            <Input
              id="ct-value"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="0.00"
              inputMode="decimal"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-currency">Monedă</Label>
            <Input
              id="ct-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ct-start">Data start</Label>
            <Input
              id="ct-start"
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
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
            <Label htmlFor="ct-autorenew">Auto-reînnoire</Label>
          </div>
          <div className="md:col-span-2">
            {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={createMut.isPending || !title.trim()}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function ContractsListPage(): JSX.Element {
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

  // KPIs
  const active = rows.filter((c) => c.status === 'ACTIVE');
  const expiringCount = active.filter((c) => expiresWithin30Days(c.endDate)).length;
  const totalActiveValue = active.reduce((sum, c) => sum + (c.value ? Number(c.value) : 0), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contracte</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Contract nou'}
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-3">
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

      {/* New contract form */}
      {showForm && <NewContractForm onDone={() => setShowForm(false)} />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as ContractStatus | '')}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate statusurile</option>
          {(Object.entries(STATUS_LABELS) as [ContractStatus, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading && <Card><TableSkeleton rows={6} cols={7} /></Card>}
      {isError && (
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {data && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Titlu</th>
                  <th scope="col" className="px-4 py-2 font-medium">Companie</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Valoare</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Data start</th>
                  <th scope="col" className="px-4 py-2 font-medium">Data expirare</th>
                  <th scope="col" className="px-4 py-2 font-medium text-center">Auto-reînnoire</th>
                  <th scope="col" className="px-4 py-2 font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun contract. Adaugă primul contract folosind butonul de mai sus.
                    </td>
                  </tr>
                )}
                {rows.map((c) => {
                  const expiring = expiresWithin30Days(c.endDate);
                  return (
                    <tr
                      key={c.id}
                      className={`border-b last:border-0 hover:bg-muted/30 ${expiring ? 'bg-yellow-50' : ''}`}
                    >
                      <td className="px-4 py-2 font-medium">{c.title}</td>
                      <td className="px-4 py-2">
                        {c.company?.name ?? '—'}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {c.value
                          ? Number(c.value).toLocaleString('ro-RO', { maximumFractionDigits: 2 }) + ' ' + c.currency
                          : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {c.startDate ? new Date(c.startDate).toLocaleDateString('ro-RO') : '—'}
                      </td>
                      <td className={`px-4 py-2 text-xs ${expiring ? 'font-semibold text-red-600' : ''}`}>
                        {c.endDate ? new Date(c.endDate).toLocaleDateString('ro-RO') : '—'}
                        {expiring && ' ⚠'}
                      </td>
                      <td className="px-4 py-2 text-center text-xs">
                        {c.autoRenew ? 'Da' : 'Nu'}
                      </td>
                      <td className="px-4 py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (confirm('Ștergi contractul?')) {
                              deleteMut.mutate(c.id);
                            }
                          }}
                        >
                          ×
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {data?.nextCursor && (
        <div className="flex justify-center">
          <p className="text-xs text-muted-foreground">
            Există mai multe rezultate — restrânge filtrele sau implementează paginarea.
          </p>
        </div>
      )}
    </div>
  );
}
