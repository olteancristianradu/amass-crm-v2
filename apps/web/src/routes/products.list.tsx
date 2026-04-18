import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { productsApi, type CreateProductDto } from '@/features/products/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const productsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/products',
  component: ProductsListPage,
});

function ProductsListPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['products'],
    queryFn: () => productsApi.list(),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => productsApi.archive(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const rows = data?.data ?? [];

  function handleArchive(id: string, name: string): void {
    if (!confirm(`Arhivezi produsul "${name}"? Va fi ascuns din liste.`)) return;
    archiveMut.mutate(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Produse</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Produs nou'}
        </Button>
      </div>

      {showForm && <NewProductForm onDone={() => setShowForm(false)} />}

      {isLoading && (
        <Card>
          <TableSkeleton rows={5} cols={5} />
        </Card>
      )}
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
                  <th className="px-4 py-2 font-medium">Nume</th>
                  <th className="px-4 py-2 font-medium">SKU</th>
                  <th className="px-4 py-2 font-medium">Preț unitar</th>
                  <th className="px-4 py-2 font-medium">TVA %</th>
                  <th className="px-4 py-2 font-medium">Categorie</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium w-24"></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun produs. Adaugă primul produs folosind butonul de mai sus.
                    </td>
                  </tr>
                )}
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className={`border-b last:border-0 hover:bg-muted/30 ${!p.isActive ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2 font-mono text-xs">{p.sku ?? '—'}</td>
                    <td className="px-4 py-2 font-mono">
                      {Number(p.unitPrice).toFixed(2)}
                    </td>
                    <td className="px-4 py-2">{Number(p.vatRate).toFixed(0)}%</td>
                    <td className="px-4 py-2">{p.category?.name ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${
                          p.isActive
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {p.isActive ? 'Activ' : 'Arhivat'}
                      </span>
                    </td>
                    <td className="px-4 py-2">
                      {p.isActive && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={archiveMut.isPending}
                          onClick={() => handleArchive(p.id, p.name)}
                        >
                          Arhivează
                        </Button>
                      )}
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

function NewProductForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateProductDto>({
    name: '',
    sku: '',
    unitPrice: '',
    vatRate: '19',
    categoryId: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (dto: CreateProductDto) => productsApi.create(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['products'] });
      onDone();
    },
    onError: (err: unknown) => {
      setFormError(err instanceof ApiError ? err.message : 'Eroare la creare');
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setFormError(null);
    if (!form.name.trim()) {
      setFormError('Numele este obligatoriu.');
      return;
    }
    if (!form.unitPrice || isNaN(Number(form.unitPrice))) {
      setFormError('Prețul unitar trebuie să fie un număr valid.');
      return;
    }
    const dto: CreateProductDto = {
      name: form.name.trim(),
      unitPrice: form.unitPrice,
      vatRate: form.vatRate || '19',
    };
    if (form.sku?.trim()) dto.sku = form.sku.trim();
    if (form.categoryId?.trim()) dto.categoryId = form.categoryId.trim();
    createMut.mutate(dto);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Produs nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="p-name">Nume *</Label>
            <Input
              id="p-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-sku">SKU</Label>
            <Input
              id="p-sku"
              value={form.sku ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
              placeholder="ex: PRD-001"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-price">Preț unitar (RON) *</Label>
            <Input
              id="p-price"
              type="number"
              step="0.01"
              min="0"
              value={form.unitPrice}
              onChange={(e) => setForm((f) => ({ ...f, unitPrice: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-vat">Cotă TVA (%)</Label>
            <select
              id="p-vat"
              value={form.vatRate}
              onChange={(e) => setForm((f) => ({ ...f, vatRate: e.target.value }))}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="0">0%</option>
              <option value="5">5%</option>
              <option value="9">9%</option>
              <option value="19">19%</option>
            </select>
          </div>
          <div className="md:col-span-2">
            {formError && (
              <p className="mb-2 text-sm text-destructive">{formError}</p>
            )}
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
