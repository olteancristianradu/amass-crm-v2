import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { authedRoute } from './authed';
import { api, ApiError } from '@/lib/api';
import { CreatePhoneNumberSchema, type CreatePhoneNumberDto } from '@amass/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const phoneSettingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/phone-settings',
  component: PhoneSettingsPage,
});

interface PhoneNumber {
  id: string;
  twilioSid: string;
  number: string;
  label: string | null;
  isDefault: boolean;
  userId: string | null;
}

function PhoneSettingsPage(): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['phone-numbers'],
    queryFn: () => api.get<PhoneNumber[]>('/phone-numbers'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/phone-numbers/${id}`),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['phone-numbers'] });
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Setări telefonie</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Număr nou'}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">
        Numerele de telefon Twilio asociate acestui cont. Cumpărați numerele din consola Twilio,
        apoi înregistrați-le aici cu SID-ul corespunzător.
      </p>

      {showForm && <NewPhoneForm onDone={() => setShowForm(false)} />}

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
                  <th className="px-4 py-2 font-medium">Număr</th>
                  <th className="px-4 py-2 font-medium">Etichetă</th>
                  <th className="px-4 py-2 font-medium">Twilio SID</th>
                  <th className="px-4 py-2 font-medium">Implicit</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun număr înregistrat.
                    </td>
                  </tr>
                )}
                {data.map((pn) => (
                  <tr key={pn.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono">{pn.number}</td>
                    <td className="px-4 py-2">{pn.label ?? '—'}</td>
                    <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{pn.twilioSid}</td>
                    <td className="px-4 py-2">{pn.isDefault ? 'Da' : '—'}</td>
                    <td className="px-4 py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={deleteMut.isPending}
                        onClick={() => {
                          if (confirm(`Ștergi numărul ${pn.number}?`)) {
                            deleteMut.mutate(pn.id);
                          }
                        }}
                      >
                        Șterge
                      </Button>
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

function NewPhoneForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<CreatePhoneNumberDto>({
    resolver: zodResolver(CreatePhoneNumberSchema),
    defaultValues: { isDefault: false },
  });

  const createMut = useMutation({
    mutationFn: (dto: CreatePhoneNumberDto) => api.post<PhoneNumber>('/phone-numbers', dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['phone-numbers'] });
      reset();
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Număr nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => createMut.mutate(v))}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="twilioSid">Twilio SID *</Label>
            <Input id="twilioSid" placeholder="PNxxxxxxxx" {...register('twilioSid')} />
            {errors.twilioSid && (
              <p className="text-xs text-destructive">{errors.twilioSid.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="number">Număr (E.164) *</Label>
            <Input id="number" placeholder="+40712345678" {...register('number')} />
            {errors.number && (
              <p className="text-xs text-destructive">{errors.number.message}</p>
            )}
          </div>
          <div className="space-y-1">
            <Label htmlFor="label">Etichetă</Label>
            <Input id="label" placeholder="Linie principală" {...register('label')} />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input type="checkbox" id="isDefault" {...register('isDefault')} className="h-4 w-4" />
            <Label htmlFor="isDefault" className="cursor-pointer">Număr implicit</Label>
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
