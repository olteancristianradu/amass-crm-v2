import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { ordersApi, type OrderStatus } from '@/features/orders/api';
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

const STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Schiță',
  CONFIRMED: 'Confirmată',
  FULFILLED: 'Livrată',
  CANCELLED: 'Anulată',
};

const STATUS_TONES: Record<OrderStatus, StatusBadgeTone> = {
  DRAFT: 'neutral',
  CONFIRMED: 'blue',
  FULFILLED: 'green',
  CANCELLED: 'pink',
};

interface ItemDraft {
  description: string;
  quantity: string;
  unitPrice: string;
}

function NewOrderForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [currency, setCurrency] = useState('RON');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemDraft[]>([
    { description: '', quantity: '1', unitPrice: '0' },
  ]);
  const [error, setError] = useState<string | null>(null);

  const { data: companies } = useQuery({
    queryKey: ['companies', 'for-order-form'],
    queryFn: () => companiesApi.list(undefined, 50, undefined),
  });

  const mut = useMutation({
    mutationFn: () =>
      ordersApi.create({
        companyId,
        currency,
        notes: notes || undefined,
        items: items
          .filter((i) => i.description.trim())
          .map((i) => ({
            description: i.description,
            quantity: Number(i.quantity) || 1,
            unitPrice: Number(i.unitPrice) || 0,
          })),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['orders'] });
      onDone();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Eroare la creare.');
    },
  });

  const updateItem = (idx: number, field: keyof ItemDraft, value: string): void => {
    setItems(items.map((it, i) => (i === idx ? { ...it, [field]: value } : it)));
  };

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Comandă nouă</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          mut.mutate();
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="ord-company">Companie *</Label>
            <select
              id="ord-company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              required
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
            <Label htmlFor="ord-currency">Monedă</Label>
            <Input
              id="ord-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              maxLength={3}
              className="tabular-nums"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Linii comandă</Label>
          {items.map((it, idx) => (
            <div key={idx} className="grid gap-2 md:grid-cols-[1fr_100px_120px_40px]">
              <Input
                placeholder="Descriere"
                value={it.description}
                onChange={(e) => updateItem(idx, 'description', e.target.value)}
              />
              <Input
                placeholder="Cant."
                inputMode="decimal"
                value={it.quantity}
                onChange={(e) => updateItem(idx, 'quantity', e.target.value)}
                className="tabular-nums"
              />
              <Input
                placeholder="Preț unitar"
                inputMode="decimal"
                value={it.unitPrice}
                onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                className="tabular-nums"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setItems(items.filter((_, i) => i !== idx))}
                disabled={items.length === 1}
                aria-label="Șterge linie"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setItems([...items, { description: '', quantity: '1', unitPrice: '0' }])}
          >
            <Plus size={14} className="mr-1" /> Linie
          </Button>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="ord-notes">Note</Label>
          <textarea
            id="ord-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        {error && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Anulează
          </Button>
          <Button type="submit" disabled={mut.isPending || !companyId}>
            {mut.isPending ? 'Se salvează…' : 'Salvează'}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

export function OrdersListPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<OrderStatus | ''>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['orders', { filterStatus }],
    queryFn: () => ordersApi.list({ status: filterStatus || undefined, limit: 50 }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      ordersApi.update(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orders'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => ordersApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['orders'] }),
  });

  const rows = data?.data ?? [];
  const confirmedValue = rows
    .filter((o) => o.status === 'CONFIRMED' || o.status === 'FULFILLED')
    .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

  return (
    <div>
      <PageHeader
        title="Comenzi"
        subtitle="Toate comenzile clienților — DRAFT, CONFIRMED, FULFILLED, CANCELLED."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Comandă nouă'}
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <KpiCard title="Total comenzi" value={rows.length} />
        <KpiCard
          title="Confirmate / livrate"
          value={rows.filter((o) => o.status === 'CONFIRMED' || o.status === 'FULFILLED').length}
        />
        <KpiCard
          title="Valoare confirmată"
          value={`${confirmedValue.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON`}
        />
      </div>

      {showForm && <NewOrderForm onDone={() => setShowForm(false)} />}

      <Toolbar>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as OrderStatus | '')}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate statusurile</option>
          {(Object.entries(STATUS_LABELS) as [OrderStatus, string][]).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
      </Toolbar>

      {isLoading && (
        <ListSurface>
          <TableSkeleton rows={6} cols={5} />
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
              icon={ShoppingBag}
              title={filterStatus ? 'Nicio comandă pentru filtrul curent' : 'Nicio comandă încă'}
              description={
                filterStatus
                  ? 'Schimbă filtrul de status pentru a vedea alte comenzi.'
                  : 'Creează prima comandă, sau convertește o ofertă acceptată în comandă.'
              }
              action={
                !filterStatus && (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Comandă nouă
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">#</th>
                    <th scope="col" className="px-4 py-3 font-medium">Companie</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Total</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">Creat</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o) => (
                    <tr
                      key={o.id}
                      className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3 font-mono text-xs tabular-nums">#{o.number}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {o.companyId}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {Number(o.totalAmount).toLocaleString('ro-RO', { maximumFractionDigits: 2 })}{' '}
                        {o.currency}
                      </td>
                      <td className="px-4 py-3">
                        <select
                          value={o.status}
                          onChange={(e) =>
                            updateMut.mutate({ id: o.id, status: e.target.value as OrderStatus })
                          }
                          className="rounded-md border border-input bg-background px-2 py-0.5 text-xs"
                        >
                          {(Object.entries(STATUS_LABELS) as [OrderStatus, string][]).map(
                            ([val, label]) => (
                              <option key={val} value={val}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>
                        {' '}
                        <span className="ml-1 inline-block">
                          <StatusBadge tone={STATUS_TONES[o.status]}>
                            {STATUS_LABELS[o.status]}
                          </StatusBadge>
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                        {new Date(o.createdAt).toLocaleDateString('ro-RO')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (confirm('Ștergi comanda?')) deleteMut.mutate(o.id);
                          }}
                          aria-label="Șterge comandă"
                        >
                          <Trash2 size={14} />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ListSurface>
      )}
    </div>
  );
}

function KpiCard({ title, value }: { title: string; value: number | string }): JSX.Element {
  return (
    <GlassCard className="p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
    </GlassCard>
  );
}
