import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { authedRoute } from './authed';
import { smsApi, type SendSmsDto } from '@/features/sms/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';

export const smsInboxRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/sms',
  component: SmsInboxPage,
});

const DIRECTION_COLORS: Record<string, string> = {
  INBOUND: 'bg-blue-100 text-blue-800',
  OUTBOUND: 'bg-green-100 text-green-800',
};

const STATUS_COLORS: Record<string, string> = {
  QUEUED: 'bg-gray-100 text-gray-600',
  SENDING: 'bg-yellow-100 text-yellow-800',
  SENT: 'bg-green-100 text-green-800',
  DELIVERED: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
  UNDELIVERED: 'bg-orange-100 text-orange-800',
};

function SmsInboxPage(): JSX.Element {
  const [showForm, setShowForm] = useState(false);
  const [filterContactId, setFilterContactId] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['sms', { contactId: filterContactId || undefined }],
    queryFn: () => smsApi.list(filterContactId || undefined),
  });

  const messages = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">SMS Inbox</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Trimite SMS'}
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Input
          placeholder="Filtrează după Contact ID…"
          value={filterContactId}
          onChange={(e) => setFilterContactId(e.target.value)}
          className="max-w-xs"
        />
      </div>

      {showForm && <SendSmsForm onDone={() => setShowForm(false)} />}

      {isLoading && <div className="animate-pulse h-8 bg-gray-100 rounded w-full" />}
      {isError && (
        <p className="text-red-500 text-sm">
          {error instanceof ApiError ? error.message : String(error)}
        </p>
      )}

      {data && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Direcție</th>
                  <th className="px-4 py-2 font-medium">De la</th>
                  <th className="px-4 py-2 font-medium">Către</th>
                  <th className="px-4 py-2 font-medium">Mesaj</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Data</th>
                </tr>
              </thead>
              <tbody>
                {messages.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun mesaj SMS.
                    </td>
                  </tr>
                )}
                {messages.map((m) => (
                  <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${DIRECTION_COLORS[m.direction] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {m.direction === 'INBOUND' ? 'IN' : 'OUT'}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{m.fromNumber}</td>
                    <td className="px-4 py-2 font-mono text-xs">{m.toNumber}</td>
                    <td className="px-4 py-2 max-w-sm truncate" title={m.body}>
                      {m.body}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[m.status] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(m.createdAt).toLocaleString('ro-RO')}
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

function SendSmsForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<SendSmsDto>();

  const sendMut = useMutation({
    mutationFn: (dto: SendSmsDto) => smsApi.send(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['sms'] });
      reset();
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Trimite SMS</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => sendMut.mutate(v))}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="toNumber">Număr destinatar * (format E.164)</Label>
            <Input
              id="toNumber"
              placeholder="+40712345678"
              {...register('toNumber', {
                required: 'Numărul este obligatoriu',
                pattern: {
                  value: /^\+[1-9]\d{6,14}$/,
                  message: 'Format E.164 invalid (ex: +40712345678)',
                },
              })}
            />
            {errors.toNumber && (
              <p className="text-xs text-destructive">{errors.toNumber.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="contactId">Contact ID (opțional)</Label>
            <Input
              id="contactId"
              placeholder="UUID contact…"
              {...register('contactId')}
            />
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="body">Mesaj *</Label>
            <textarea
              id="body"
              rows={3}
              placeholder="Conținut mesaj…"
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...register('body', { required: 'Mesajul este obligatoriu' })}
            />
            {errors.body && (
              <p className="text-xs text-destructive">{errors.body.message}</p>
            )}
          </div>

          <div className="md:col-span-2">
            {sendMut.isError && (
              <p className="mb-2 text-sm text-destructive">
                {sendMut.error instanceof ApiError ? sendMut.error.message : 'Eroare la trimitere'}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting || sendMut.isPending}>
              {sendMut.isPending ? 'Se trimite…' : 'Trimite'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
