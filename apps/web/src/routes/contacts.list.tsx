import { createRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { authedRoute } from './authed';
import { contactsApi } from '@/features/contacts/api';
import { CreateContactSchema, type CreateContactDto } from '@amass/shared';
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

export const contactsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/contacts',
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  component: ContactsListPage,
});

function ContactsListPage(): JSX.Element {
  const { q } = contactsRoute.useSearch();
  const navigate = contactsRoute.useNavigate();
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['contacts', { q }],
    queryFn: () => contactsApi.list(undefined, 50, q),
  });

  const bulkDeleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map((id) => contactsApi.remove(id)));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['contacts'] });
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
      const n = new Set(prev);
      if (n.has(id)) { n.delete(id); } else { n.add(id); }
      return n;
    });
  }
  function handleBulkDelete(): void {
    if (!confirm(`Ștergi ${selected.size} contacte? Ireversibil.`)) return;
    bulkDeleteMut.mutate([...selected]);
  }
  function handleExportCsv(): void {
    const exportRows = rows
      .filter((c) => selected.size === 0 || selected.has(c.id))
      .map((c) => ({
        Prenume: c.firstName, Nume: c.lastName, Functie: c.jobTitle ?? '',
        Email: c.email ?? '', Telefon: c.phone ?? '', Mobil: c.mobile ?? '',
      }));
    downloadCsv(exportRows, `contacte-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contacte</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportCsv}>
            Export CSV {selected.size > 0 ? `(${selected.size})` : '(toate)'}
          </Button>
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Anulează' : '+ Contact nou'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Caută…"
          defaultValue={q ?? ''}
          onChange={(e) => void navigate({ search: { q: e.target.value || undefined } })}
          className="max-w-sm"
        />
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" disabled={bulkDeleteMut.isPending} onClick={handleBulkDelete}>
            Șterge {selected.size} selectate
          </Button>
        )}
      </div>

      {showForm && <NewContactForm onDone={() => setShowForm(false)} />}

      {isLoading && <Card><TableSkeleton rows={5} cols={5} /></Card>}
      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Eroare'}
        </p>
      )}

      {data && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                  </th>
                  <th className="px-4 py-2 font-medium">Nume</th>
                  <th className="px-4 py-2 font-medium">Funcție</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Telefon</th>
                  <th className="px-4 py-2 font-medium">Decident</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">Niciun contact.</td>
                  </tr>
                )}
                {rows.map((c) => (
                  <tr key={c.id} className={`border-b last:border-0 hover:bg-muted/30 ${selected.has(c.id) ? 'bg-primary/5' : ''}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleOne(c.id)} className="rounded" />
                    </td>
                    <td className="px-4 py-2 font-medium">
                      <Link to="/app/contacts/$id" params={{ id: c.id }} className="hover:underline">
                        {c.firstName} {c.lastName}
                      </Link>
                    </td>
                    <td className="px-4 py-2">{c.jobTitle ?? '—'}</td>
                    <td className="px-4 py-2">{c.email ?? '—'}</td>
                    <td className="px-4 py-2">{c.phone ?? c.mobile ?? '—'}</td>
                    <td className="px-4 py-2">
                      {(c as { isDecider?: boolean }).isDecider
                        ? <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Da</span>
                        : <span className="text-muted-foreground text-xs">Nu</span>}
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

function NewContactForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateContactDto>({
    resolver: zodResolver(CreateContactSchema),
  });

  const createMut = useMutation({
    mutationFn: (dto: CreateContactDto) => contactsApi.create(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contacts'] });
      reset();
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Contact nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => createMut.mutate(v))}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="firstName">Prenume *</Label>
            <Input id="firstName" {...register('firstName')} />
            {errors.firstName && (
              <p className="text-xs text-destructive">{errors.firstName.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="lastName">Nume *</Label>
            <Input id="lastName" {...register('lastName')} />
            {errors.lastName && (
              <p className="text-xs text-destructive">{errors.lastName.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="jobTitle">Funcție</Label>
            <Input id="jobTitle" {...register('jobTitle')} />
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
            <Label htmlFor="mobile">Mobil</Label>
            <Input id="mobile" {...register('mobile')} />
          </div>
          <div className="flex items-center gap-2 md:col-span-2">
            <input type="checkbox" id="isDecider" {...register('isDecider')} className="h-4 w-4 rounded border-input" />
            <Label htmlFor="isDecider" className="cursor-pointer">Factor de decizie (decident)</Label>
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
