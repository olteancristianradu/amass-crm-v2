import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Contact2, Download, Plus, Search, Trash2 } from 'lucide-react';
import { contactsApi } from '@/features/contacts/api';
import { CreateContactSchema, type CreateContactDto } from '@amass/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  BulkActionsBar,
  EmptyState,
  ListSurface,
  PageHeader,
  StatusBadge,
  Toolbar,
} from '@/components/ui/page-header';
import { ApiError } from '@/lib/api';
import { InlineEditCell } from '@/components/ui/InlineEditCell';
import { downloadCsv } from '@/lib/csv';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { contactsRoute } from './contacts.list';

export function ContactsListPage(): JSX.Element {
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
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function handleBulkDelete(): void {
    if (!confirm(`Ștergi ${selected.size} contacte? Acțiunea este ireversibilă.`)) return;
    bulkDeleteMut.mutate([...selected]);
  }
  function handleExportCsv(): void {
    const exportRows = rows
      .filter((c) => selected.size === 0 || selected.has(c.id))
      .map((c) => ({
        Prenume: c.firstName,
        Nume: c.lastName,
        Functie: c.jobTitle ?? '',
        Email: c.email ?? '',
        Telefon: c.phone ?? '',
        Mobil: c.mobile ?? '',
      }));
    downloadCsv(exportRows, `contacte-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <div>
      <PageHeader
        title="Contacte"
        subtitle="Persoanele de contact din companiile cu care lucrezi."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download size={14} className="mr-1.5" />
              Export {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Plus size={14} className="mr-1.5" />
              {showForm ? 'Anulează' : 'Contact nou'}
            </Button>
          </>
        }
      />

      <Toolbar>
        <div className="relative flex-1 sm:max-w-sm">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Caută după nume, email, telefon…"
            defaultValue={q ?? ''}
            onChange={(e) => void navigate({ search: { q: e.target.value || undefined } })}
            className="pl-9"
          />
        </div>
      </Toolbar>

      <BulkActionsBar count={selected.size} onClear={() => setSelected(new Set())}>
        <Button
          variant="destructive"
          size="sm"
          disabled={bulkDeleteMut.isPending}
          onClick={handleBulkDelete}
        >
          <Trash2 size={14} className="mr-1.5" />
          {bulkDeleteMut.isPending ? 'Se șterge…' : 'Șterge'}
        </Button>
      </BulkActionsBar>

      {showForm && <NewContactForm onDone={() => setShowForm(false)} />}

      {isLoading && (
        <ListSurface>
          <TableSkeleton rows={5} cols={6} />
        </ListSurface>
      )}
      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Eroare necunoscută'}
        </p>
      )}

      {data && (
        <ListSurface>
          {rows.length === 0 ? (
            <EmptyState
              icon={Contact2}
              title={q ? 'Niciun contact găsit' : 'Niciun contact încă'}
              description={
                q
                  ? `Nu am găsit contacte care să se potrivească cu "${q}".`
                  : 'Adaugă primul contact, sau atașează un contact când creezi o companie.'
              }
              action={
                !q && (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Contact nou
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="w-10 px-3 py-3">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleAll}
                        className="rounded"
                        aria-label="Selectează tot"
                      />
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">Nume</th>
                    <th scope="col" className="px-4 py-3 font-medium">Funcție</th>
                    <th scope="col" className="px-4 py-3 font-medium">Email</th>
                    <th scope="col" className="px-4 py-3 font-medium">Telefon</th>
                    <th scope="col" className="px-4 py-3 font-medium">Decident</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr
                      key={c.id}
                      className={`border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40 ${
                        selected.has(c.id) ? 'bg-primary/[0.03]' : ''
                      }`}
                    >
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selected.has(c.id)}
                          onChange={() => toggleOne(c.id)}
                          className="rounded"
                          aria-label={`Selectează ${c.firstName} ${c.lastName}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/app/contacts/$id"
                          params={{ id: c.id }}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {c.firstName} {c.lastName}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <InlineEditCell
                          value={c.jobTitle ?? ''}
                          placeholder="Funcție"
                          onSave={(v) => contactsApi.update(c.id, { jobTitle: v || null } as never)
                            .then(() => qc.invalidateQueries({ queryKey: ['contacts'] }))}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <InlineEditCell
                          value={c.email ?? ''}
                          placeholder="Email"
                          onSave={(v) => contactsApi.update(c.id, { email: v || null } as never)
                            .then(() => qc.invalidateQueries({ queryKey: ['contacts'] }))}
                        />
                      </td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {c.phone ?? c.mobile ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        {(c as { isDecider?: boolean }).isDecider ? (
                          <StatusBadge tone="green">Da</StatusBadge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
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
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Contact nou</h2>
      <form
        onSubmit={handleSubmit((v) => createMut.mutate(v))}
        className="grid gap-4 md:grid-cols-2"
      >
        <div className="space-y-1.5">
          <Label htmlFor="firstName">Prenume *</Label>
          <Input id="firstName" {...register('firstName')} />
          {errors.firstName && (
            <p className="text-xs text-destructive">{errors.firstName.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Nume *</Label>
          <Input id="lastName" {...register('lastName')} />
          {errors.lastName && (
            <p className="text-xs text-destructive">{errors.lastName.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="jobTitle">Funcție</Label>
          <Input id="jobTitle" {...register('jobTitle')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" {...register('email')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Telefon</Label>
          <Input id="phone" {...register('phone')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mobile">Mobil</Label>
          <Input id="mobile" {...register('mobile')} />
        </div>
        <div className="flex items-center gap-2 md:col-span-2">
          <input
            type="checkbox"
            id="isDecider"
            {...register('isDecider')}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor="isDecider" className="cursor-pointer">
            Factor de decizie (decident)
          </Label>
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
            <Button type="submit" disabled={isSubmitting || createMut.isPending}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}
