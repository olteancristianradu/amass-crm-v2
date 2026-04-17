import { createRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { authedRoute } from './authed';
import { companiesApi } from '@/features/companies/api';
import { CreateCompanySchema, type CreateCompanyDto } from '@amass/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { TableSkeleton } from '@/components/ui/Skeleton';

const searchSchema = z.object({
  q: z.string().optional(),
});

export const companiesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/companies',
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  component: CompaniesListPage,
});

function CompaniesListPage(): JSX.Element {
  const { q } = companiesRoute.useSearch();
  const navigate = companiesRoute.useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['companies', { q }],
    queryFn: () => companiesApi.list(undefined, 50, q),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => companiesApi.remove(id)));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['companies'] });
      setSelected(new Set());
    },
  });

  const rows = data?.data ?? [];
  const allIds = rows.map((c) => c.id);
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  function toggleAll(): void {
    setSelected(allSelected ? new Set() : new Set(allIds));
  }

  function toggleOne(id: string): void {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleBulkDelete(): void {
    if (!confirm(`Ștergi ${selected.size} compani${selected.size === 1 ? 'e' : 'i'}? Acțiunea este ireversibilă.`)) return;
    bulkDeleteMut.mutate([...selected]);
  }

  function handleExportCsv(): void {
    const exportRows = rows
      .filter((c) => selected.size === 0 || selected.has(c.id))
      .map((c) => ({
        Nume: c.name,
        CUI: c.vatNumber ?? '',
        Industrie: c.industry ?? '',
        Oras: c.city ?? '',
        Email: c.email ?? '',
        Telefon: c.phone ?? '',
        'Creat la': new Date(c.createdAt).toLocaleDateString('ro-RO'),
      }));
    downloadCsv(exportRows, `companii-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Companii</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            Export CSV {selected.size > 0 ? `(${selected.size})` : '(toate)'}
          </Button>
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Anulează' : '+ Companie nouă'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Caută după nume, CUI, email…"
          defaultValue={q ?? ''}
          onChange={(e) => {
            void navigate({ search: { q: e.target.value || undefined } });
          }}
          className="max-w-sm"
        />
        {selected.size > 0 && (
          <Button
            variant="destructive"
            size="sm"
            disabled={bulkDeleteMut.isPending}
            onClick={handleBulkDelete}
          >
            Șterge {selected.size} selectate
          </Button>
        )}
      </div>

      {showForm && <NewCompanyForm onDone={() => setShowForm(false)} />}

      {isLoading && <Card><TableSkeleton rows={6} cols={5} /></Card>}
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
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded"
                    />
                  </th>
                  <th className="px-4 py-2 font-medium">Nume</th>
                  <th className="px-4 py-2 font-medium">CUI</th>
                  <th className="px-4 py-2 font-medium">Industrie</th>
                  <th className="px-4 py-2 font-medium">Oraș</th>
                  <th className="px-4 py-2 font-medium">Creat</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Nicio companie. Adaugă prima companie folosind butonul de mai sus.
                    </td>
                  </tr>
                )}
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    className={`border-b last:border-0 hover:bg-muted/30 ${selected.has(c.id) ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(c.id)}
                        onChange={() => toggleOne(c.id)}
                        className="rounded"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        to="/app/companies/$id"
                        params={{ id: c.id }}
                        className="font-medium text-primary hover:underline"
                      >
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{c.vatNumber ?? '—'}</td>
                    <td className="px-4 py-2">{c.industry ?? '—'}</td>
                    <td className="px-4 py-2">{c.city ?? '—'}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString('ro-RO')}
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

function NewCompanyForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateCompanyDto>({
    resolver: zodResolver(CreateCompanySchema),
  });

  const createMut = useMutation({
    mutationFn: (dto: CreateCompanyDto) => companiesApi.create(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['companies'] });
      reset();
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Companie nouă</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => createMut.mutate(v))}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="name">Nume *</Label>
            <Input id="name" {...register('name')} />
            {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="vatNumber">CUI</Label>
            <Input id="vatNumber" {...register('vatNumber')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="industry">Industrie</Label>
            <Input id="industry" {...register('industry')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" {...register('email')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="phone">Telefon</Label>
            <Input id="phone" {...register('phone')} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="city">Oraș</Label>
            <Input id="city" {...register('city')} />
          </div>
          <div className="md:col-span-2">
            {createMut.isError && (
              <p className="mb-2 text-sm text-destructive">
                {createMut.error instanceof ApiError ? createMut.error.message : 'Eroare'}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting || createMut.isPending}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
