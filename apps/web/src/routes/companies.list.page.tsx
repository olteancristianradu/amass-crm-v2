import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Building2, Download, Plus, Search, Trash2 } from 'lucide-react';
import { companiesApi } from '@/features/companies/api';
import { CreateCompanySchema, type CreateCompanyDto, type RelationshipStatus } from '@amass/shared';
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
  type StatusBadgeTone,
  Toolbar,
} from '@/components/ui/page-header';
import { ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { companiesRoute } from './companies.list';

export function CompaniesListPage(): JSX.Element {
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
    // Faza-D: single round-trip + atomic transaction on the API side.
    // Was previously fan-out (N parallel deletes) which scaled poorly
    // and could leave the list in a half-deleted state on partial failure.
    mutationFn: (ids: string[]) => companiesApi.bulkDelete(ids),
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
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkDelete(): void {
    if (
      !confirm(
        `Ștergi ${selected.size} compani${selected.size === 1 ? 'e' : 'i'}? Acțiunea este ireversibilă.`,
      )
    )
      return;
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
    <div>
      <PageHeader
        title="Companii"
        subtitle="Toate organizațiile B2B din portofoliul tău."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExportCsv}>
              <Download size={14} className="mr-1.5" />
              Export {selected.size > 0 ? `(${selected.size})` : ''}
            </Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Plus size={14} className="mr-1.5" />
              {showForm ? 'Anulează' : 'Companie nouă'}
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
            placeholder="Caută după nume, CUI, email…"
            defaultValue={q ?? ''}
            onChange={(e) => {
              void navigate({ search: { q: e.target.value || undefined } });
            }}
            className="pl-9"
          />
        </div>
      </Toolbar>

      <BulkActionsBar
        count={selected.size}
        onClear={() => setSelected(new Set())}
      >
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

      {showForm && <NewCompanyForm onDone={() => setShowForm(false)} />}

      {isLoading && (
        <ListSurface>
          <TableSkeleton rows={6} cols={6} />
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
              icon={Building2}
              title={q ? 'Nicio companie găsită' : 'Nicio companie încă'}
              description={
                q
                  ? `Nu există companii care să se potrivească cu "${q}". Încearcă alți termeni sau adaugă o companie nouă.`
                  : 'Adaugă prima companie folosind butonul din dreapta sus, sau importă un CSV din meniul Operațional.'
              }
              action={
                !q && (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Companie nouă
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
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium">CUI</th>
                    <th scope="col" className="px-4 py-3 font-medium">Industrie</th>
                    <th scope="col" className="px-4 py-3 font-medium">Oraș</th>
                    <th scope="col" className="px-4 py-3 font-medium">Creat</th>
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
                          aria-label={`Selectează ${c.name}`}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          to="/app/companies/$id"
                          params={{ id: c.id }}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {c.name}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <RelationshipBadge
                          status={(c as { relationshipStatus?: RelationshipStatus }).relationshipStatus}
                        />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs tabular-nums text-muted-foreground">
                        {c.vatNumber ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.industry ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{c.city ?? '—'}</td>
                      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString('ro-RO')}
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
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Companie nouă</h2>
      <form
        onSubmit={handleSubmit((v) => createMut.mutate(v))}
        className="grid gap-4 md:grid-cols-2"
      >
        <div className="space-y-1.5">
          <Label htmlFor="name">Nume *</Label>
          <Input id="name" {...register('name')} />
          {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="vatNumber">CUI</Label>
          <Input id="vatNumber" {...register('vatNumber')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="industry">Industrie</Label>
          <Input id="industry" {...register('industry')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="relationshipStatus">Status relație</Label>
          <select
            id="relationshipStatus"
            {...register('relationshipStatus')}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">— selectează —</option>
            <option value="LEAD">Lead</option>
            <option value="PROSPECT">Prospect</option>
            <option value="ACTIVE">Activ</option>
            <option value="INACTIVE">Inactiv</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="leadSource">Sursă lead</Label>
          <select
            id="leadSource"
            {...register('leadSource')}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">— selectează —</option>
            <option value="REFERRAL">Recomandare</option>
            <option value="WEB">Website</option>
            <option value="COLD_CALL">Apel rece</option>
            <option value="EVENT">Eveniment</option>
            <option value="PARTNER">Partener</option>
            <option value="SOCIAL">Social media</option>
            <option value="OTHER">Altele</option>
          </select>
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
          <Label htmlFor="city">Oraș</Label>
          <Input id="city" {...register('city')} />
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

const RELATIONSHIP_LABELS: Record<RelationshipStatus, string> = {
  LEAD: 'Lead',
  PROSPECT: 'Prospect',
  ACTIVE: 'Activ',
  INACTIVE: 'Inactiv',
};

const RELATIONSHIP_TONES: Record<RelationshipStatus, StatusBadgeTone> = {
  LEAD: 'blue',
  PROSPECT: 'amber',
  ACTIVE: 'green',
  INACTIVE: 'neutral',
};

export function RelationshipBadge({
  status,
}: {
  status: RelationshipStatus | null | undefined;
}): JSX.Element {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <StatusBadge tone={RELATIONSHIP_TONES[status]}>
      {RELATIONSHIP_LABELS[status]}
    </StatusBadge>
  );
}
