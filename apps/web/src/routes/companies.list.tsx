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
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['companies', { q }],
    queryFn: () => companiesApi.list(undefined, 50, q),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Companii</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Companie nouă'}
        </Button>
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="Caută după nume, CUI, email…"
          defaultValue={q ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            // debounce-free: with staleTime=30s the extra refetch is cheap
            void navigate({ search: { q: v || undefined } });
          }}
          className="max-w-sm"
        />
      </div>

      {showForm && <NewCompanyForm onDone={() => setShowForm(false)} />}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {isError && (
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {data && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Nume</th>
                  <th className="px-4 py-2 font-medium">CUI</th>
                  <th className="px-4 py-2 font-medium">Industrie</th>
                  <th className="px-4 py-2 font-medium">Oraș</th>
                  <th className="px-4 py-2 font-medium">Creat</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Nicio companie. Adaugă prima companie folosind butonul de mai sus.
                    </td>
                  </tr>
                )}
                {data.data.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
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
