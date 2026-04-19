import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { ordersApi, type OrderStatus } from '@/features/orders/api';
import { companiesApi } from '@/features/companies/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const ordersListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/orders',
  component: OrdersListPage,
});

const STATUS_LABELS: Record<OrderStatus, string> = {
  DRAFT: 'Schiță',
  CONFIRMED: 'Confirmată',
  FULFILLED: 'Livrată',
  CANCELLED: 'Anulată',
};

const STATUS_CLASSES: Record<OrderStatus, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  CONFIRMED: 'bg-blue-100 text-blue-800',
  FULFILLED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
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
  const [items, setItems] = useState<ItemDraft[]>([{ description: '', quantity: '1', unitPrice: '0' }]);
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
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Comandă nouă</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => { e.preventDefault(); setError(null); mut.mutate(); }}
          className="space-y-3"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ord-company">Companie *</Label>
              <select
                id="ord-company"
                value={companyId}
                onChange={(e) => setCompanyId(e.target.value)}
                required
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">— alege —</option>
                {companies?.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ord-currency">Monedă</Label>
              <Input id="ord-currency" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
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
                />
                <Input
                  placeholder="Preț unitar"
                  inputMode="decimal"
                  value={it.unitPrice}
                  onChange={(e) => updateItem(idx, 'unitPrice', e.target.value)}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setItems(items.filter((_, i) => i !== idx))}
                  disabled={items.length === 1}
                >×</Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setItems([...items, { description: '', quantity: '1', unitPrice: '0' }])}
            >+ Adaugă linie</Button>
          </div>

          <div className="space-y-1">
            <Label htmlFor="ord-notes">Note</Label>
            <textarea
              id="ord-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={mut.isPending || !companyId}>
            {mut.isPending ? 'Se salvează…' : 'Salvează'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function OrdersListPage(): JSX.Element {
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Comenzi</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Comandă nouă'}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Total comenzi</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{rows.length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Confirmate / livrate</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{rows.filter((o) => o.status === 'CONFIRMED' || o.status === 'FULFILLED').length}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Valoare confirmată</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{confirmedValue.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</div></CardContent>
        </Card>
      </div>

      {showForm && <NewOrderForm onDone={() => setShowForm(false)} />}

      <select
        value={filterStatus}
        onChange={(e) => setFilterStatus(e.target.value as OrderStatus | '')}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Toate statusurile</option>
        {(Object.entries(STATUS_LABELS) as [OrderStatus, string][]).map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>

      {isLoading && <Card><TableSkeleton rows={6} cols={5} /></Card>}
      {isError && <p className="text-sm text-destructive">Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}</p>}

      {data && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">#</th>
                  <th className="px-4 py-2 font-medium">Companie</th>
                  <th className="px-4 py-2 font-medium text-right">Total</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Creat</th>
                  <th className="px-4 py-2 font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">Nicio comandă.</td></tr>
                )}
                {rows.map((o) => (
                  <tr key={o.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono text-xs">#{o.number}</td>
                    <td className="px-4 py-2 font-mono text-xs">{o.companyId}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {Number(o.totalAmount).toLocaleString('ro-RO', { maximumFractionDigits: 2 })} {o.currency}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={o.status}
                        onChange={(e) => updateMut.mutate({ id: o.id, status: e.target.value as OrderStatus })}
                        className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASSES[o.status]} border-0`}
                      >
                        {(Object.entries(STATUS_LABELS) as [OrderStatus, string][]).map(([val, label]) => (
                          <option key={val} value={val}>{label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(o.createdAt).toLocaleDateString('ro-RO')}
                    </td>
                    <td className="px-4 py-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={deleteMut.isPending}
                        onClick={() => { if (confirm('Ștergi comanda?')) deleteMut.mutate(o.id); }}
                      >×</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
