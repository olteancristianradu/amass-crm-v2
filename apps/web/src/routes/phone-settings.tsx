import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Phone, Plus, Trash2 } from 'lucide-react';
import { authedRoute } from './authed';
import { api, ApiError } from '@/lib/api';
import { CreatePhoneNumberSchema, type CreatePhoneNumberDto } from '@amass/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  ListSurface,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-header';

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
    <div>
      <PageHeader
        title="Setări telefonie"
        subtitle="Numerele Twilio asociate contului. Cumpără-le în consola Twilio, apoi înregistrează-le aici cu SID-ul."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Număr nou'}
          </Button>
        }
      />

      {showForm && <NewPhoneForm onDone={() => setShowForm(false)} />}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Eroare'}
        </p>
      )}

      {data && (
        <ListSurface>
          {data.length === 0 ? (
            <EmptyState
              icon={Phone}
              title="Niciun număr înregistrat"
              description="Cumpără un număr din consola Twilio și înregistrează-l aici cu SID-ul corespunzător pentru a putea apela direct din CRM."
              action={
                <Button size="sm" onClick={() => setShowForm(true)}>
                  <Plus size={14} className="mr-1.5" /> Număr nou
                </Button>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">Număr</th>
                    <th scope="col" className="px-4 py-3 font-medium">Etichetă</th>
                    <th scope="col" className="px-4 py-3 font-medium">Twilio SID</th>
                    <th scope="col" className="px-4 py-3 font-medium">Implicit</th>
                    <th scope="col" className="px-4 py-3 text-right font-medium">Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((pn) => (
                    <tr
                      key={pn.id}
                      className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3 font-mono tabular-nums">{pn.number}</td>
                      <td className="px-4 py-3 text-muted-foreground">{pn.label ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {pn.twilioSid}
                      </td>
                      <td className="px-4 py-3">
                        {pn.isDefault ? (
                          <StatusBadge tone="green">Da</StatusBadge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (confirm(`Ștergi numărul ${pn.number}?`)) {
                              deleteMut.mutate(pn.id);
                            }
                          }}
                          aria-label="Șterge număr"
                        >
                          <Trash2 size={14} />
                        </Button>
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
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Număr nou</h2>
      <form
        onSubmit={handleSubmit((v) => createMut.mutate(v))}
        className="grid gap-4 md:grid-cols-2"
      >
        <div className="space-y-1.5">
          <Label htmlFor="twilioSid">Twilio SID *</Label>
          <Input
            id="twilioSid"
            placeholder="PNxxxxxxxx"
            className="font-mono text-xs"
            {...register('twilioSid')}
          />
          {errors.twilioSid && (
            <p className="text-xs text-destructive">{errors.twilioSid.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="number">Număr (E.164) *</Label>
          <Input
            id="number"
            placeholder="+40712345678"
            className="tabular-nums"
            {...register('number')}
          />
          {errors.number && <p className="text-xs text-destructive">{errors.number.message}</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="label">Etichetă</Label>
          <Input id="label" placeholder="Linie principală" {...register('label')} />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <input
            type="checkbox"
            id="isDefault"
            {...register('isDefault')}
            className="h-4 w-4 rounded border-input"
          />
          <Label htmlFor="isDefault" className="cursor-pointer">
            Număr implicit
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
