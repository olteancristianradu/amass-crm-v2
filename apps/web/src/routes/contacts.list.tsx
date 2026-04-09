import { createRoute } from '@tanstack/react-router';
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
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['contacts', { q }],
    queryFn: () => contactsApi.list(undefined, 50, q),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Contacte</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Contact nou'}
        </Button>
      </div>

      <Input
        placeholder="Caută…"
        defaultValue={q ?? ''}
        onChange={(e) => void navigate({ search: { q: e.target.value || undefined } })}
        className="max-w-sm"
      />

      {showForm && <NewContactForm onDone={() => setShowForm(false)} />}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Eroare'}
        </p>
      )}

      {data && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Nume</th>
                  <th className="px-4 py-2 font-medium">Funcție</th>
                  <th className="px-4 py-2 font-medium">Email</th>
                  <th className="px-4 py-2 font-medium">Telefon</th>
                </tr>
              </thead>
              <tbody>
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun contact.
                    </td>
                  </tr>
                )}
                {data.data.map((c) => (
                  <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">
                      {c.firstName} {c.lastName}
                    </td>
                    <td className="px-4 py-2">{c.jobTitle ?? '—'}</td>
                    <td className="px-4 py-2">{c.email ?? '—'}</td>
                    <td className="px-4 py-2">{c.phone ?? c.mobile ?? '—'}</td>
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
