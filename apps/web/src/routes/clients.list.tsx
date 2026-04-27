import { createRoute, Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useState } from 'react';
import { Plus, Search, Users } from 'lucide-react';
import { authedRoute } from './authed';
import { clientsApi } from '@/features/clients/api';
import { CreateClientSchema, type CreateClientDto } from '@amass/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  ListSurface,
  PageHeader,
  Toolbar,
} from '@/components/ui/page-header';
import { ApiError } from '@/lib/api';
import { TableSkeleton } from '@/components/ui/Skeleton';

const searchSchema = z.object({
  q: z.string().optional(),
});

export const clientsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/clients',
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  component: ClientsListPage,
});

function ClientsListPage(): JSX.Element {
  const { q } = clientsRoute.useSearch();
  const navigate = clientsRoute.useNavigate();
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['clients', { q }],
    queryFn: () => clientsApi.list(undefined, 50, q),
  });

  const rows = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Clienți"
        subtitle="Persoanele B2C — clienții individuali, nu companiile."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Client nou'}
          </Button>
        }
      />

      <Toolbar>
        <div className="relative flex-1 sm:max-w-sm">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            placeholder="Caută după nume, email, oraș…"
            defaultValue={q ?? ''}
            onChange={(e) => void navigate({ search: { q: e.target.value || undefined } })}
            className="pl-9"
          />
        </div>
      </Toolbar>

      {showForm && <NewClientForm onDone={() => setShowForm(false)} />}

      {isLoading && (
        <ListSurface>
          <TableSkeleton rows={5} cols={4} />
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
              icon={Users}
              title={q ? 'Niciun client găsit' : 'Niciun client încă'}
              description={
                q
                  ? `Nu am găsit clienți care să se potrivească cu "${q}".`
                  : 'Adaugă primul client B2C, sau importă o listă din meniul Operațional.'
              }
              action={
                !q && (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Client nou
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">Nume</th>
                    <th scope="col" className="px-4 py-3 font-medium">Email</th>
                    <th scope="col" className="px-4 py-3 font-medium">Telefon</th>
                    <th scope="col" className="px-4 py-3 font-medium">Oraș</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr
                      key={c.id}
                      className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3">
                        <Link
                          to="/app/clients/$id"
                          params={{ id: c.id }}
                          className="font-medium text-foreground underline-offset-4 hover:underline"
                        >
                          {c.firstName} {c.lastName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.email ?? '—'}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">
                        {c.phone ?? c.mobile ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{c.city ?? '—'}</td>
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

function NewClientForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreateClientDto>({
    resolver: zodResolver(CreateClientSchema),
  });

  const createMut = useMutation({
    mutationFn: (dto: CreateClientDto) => clientsApi.create(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['clients'] });
      reset();
      onDone();
    },
  });

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Client nou</h2>
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
