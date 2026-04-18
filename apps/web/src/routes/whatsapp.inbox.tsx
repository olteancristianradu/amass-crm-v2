import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { authedRoute } from './authed';
import {
  whatsappApi,
  type ConnectAccountDto,
  type SendWhatsAppDto,
} from '@/features/whatsapp/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';

export const whatsappInboxRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/whatsapp',
  component: WhatsAppInboxPage,
});

const MSG_DIRECTION_COLORS: Record<string, string> = {
  INBOUND: 'bg-blue-100 text-blue-800',
  OUTBOUND: 'bg-green-100 text-green-800',
};

const MSG_STATUS_COLORS: Record<string, string> = {
  QUEUED: 'bg-gray-100 text-gray-600',
  SENT: 'bg-blue-100 text-blue-800',
  DELIVERED: 'bg-green-100 text-green-800',
  READ: 'bg-emerald-100 text-emerald-800',
  FAILED: 'bg-red-100 text-red-800',
};

function WhatsAppInboxPage(): JSX.Element {
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const { data: accountsData, isLoading: accountsLoading, isError: accountsError, error: accountsErr } = useQuery({
    queryKey: ['whatsapp', 'accounts'],
    queryFn: () => whatsappApi.listAccounts(),
  });

  const { data: messagesData, isLoading: messagesLoading, isError: messagesError, error: messagesErr } = useQuery({
    queryKey: ['whatsapp', 'messages', selectedAccountId],
    queryFn: () => whatsappApi.listMessages(selectedAccountId),
    enabled: Boolean(selectedAccountId),
  });

  const accounts = accountsData?.data ?? [];
  const messages = messagesData?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setShowConnectForm((v) => !v)}>
            {showConnectForm ? 'Anulează' : '+ Conectează cont'}
          </Button>
          <Button onClick={() => setShowSendForm((v) => !v)}>
            {showSendForm ? 'Anulează' : '+ Trimite mesaj'}
          </Button>
        </div>
      </div>

      {showConnectForm && <ConnectAccountForm onDone={() => setShowConnectForm(false)} />}
      {showSendForm && (
        <SendMessageForm
          accounts={accounts}
          onDone={() => setShowSendForm(false)}
        />
      )}

      {/* Accounts list */}
      {accountsLoading && <div className="animate-pulse h-8 bg-gray-100 rounded w-full" />}
      {accountsError && (
        <p className="text-red-500 text-sm">
          {accountsErr instanceof ApiError ? accountsErr.message : String(accountsErr)}
        </p>
      )}

      {accountsData && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Conturi conectate ({accounts.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-2 font-medium">Phone Number ID</th>
                  <th className="px-4 py-2 font-medium">Nume afișat</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Creat</th>
                  <th className="px-4 py-2 font-medium">Mesaje</th>
                </tr>
              </thead>
              <tbody>
                {accounts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun cont conectat. Conectează un cont folosind butonul de mai sus.
                    </td>
                  </tr>
                )}
                {accounts.map((a) => (
                  <tr
                    key={a.id}
                    className={`border-b last:border-0 hover:bg-muted/30 ${selectedAccountId === a.id ? 'bg-primary/5' : ''}`}
                  >
                    <td className="px-4 py-2 font-mono text-xs">{a.phoneNumberId}</td>
                    <td className="px-4 py-2">{a.displayName ?? '—'}</td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${a.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {a.isActive ? 'Activ' : 'Inactiv'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(a.createdAt).toLocaleDateString('ro-RO')}
                    </td>
                    <td className="px-4 py-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setSelectedAccountId((prev) => (prev === a.id ? '' : a.id))
                        }
                      >
                        {selectedAccountId === a.id ? 'Ascunde' : 'Vezi mesaje'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Messages list for selected account */}
      {selectedAccountId && (
        <>
          {messagesLoading && <div className="animate-pulse h-8 bg-gray-100 rounded w-full" />}
          {messagesError && (
            <p className="text-red-500 text-sm">
              {messagesErr instanceof ApiError ? messagesErr.message : String(messagesErr)}
            </p>
          )}

          {messagesData && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Mesaje cont ({messages.length})
                </CardTitle>
              </CardHeader>
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
                          Niciun mesaj pentru acest cont.
                        </td>
                      </tr>
                    )}
                    {messages.map((m) => (
                      <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-medium ${MSG_DIRECTION_COLORS[m.direction] ?? 'bg-gray-100 text-gray-600'}`}
                          >
                            {m.direction === 'INBOUND' ? 'IN' : 'OUT'}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{m.fromNumber}</td>
                        <td className="px-4 py-2 font-mono text-xs">{m.toNumber}</td>
                        <td
                          className="px-4 py-2 max-w-sm truncate"
                          title={m.body}
                        >
                          {m.body}
                        </td>
                        <td className="px-4 py-2">
                          <span
                            className={`rounded px-2 py-0.5 text-xs font-medium ${MSG_STATUS_COLORS[m.status] ?? 'bg-gray-100 text-gray-600'}`}
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
        </>
      )}
    </div>
  );
}

function ConnectAccountForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ConnectAccountDto>();

  const connectMut = useMutation({
    mutationFn: (dto: ConnectAccountDto) => whatsappApi.connectAccount(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['whatsapp', 'accounts'] });
      reset();
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Conectează cont WhatsApp Business</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => connectMut.mutate(v))}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="phoneNumberId">Phone Number ID *</Label>
            <Input
              id="phoneNumberId"
              placeholder="ex: 123456789012345"
              {...register('phoneNumberId', { required: 'Phone Number ID este obligatoriu' })}
            />
            {errors.phoneNumberId && (
              <p className="text-xs text-destructive">{errors.phoneNumberId.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="verifyToken">Verify Token *</Label>
            <Input
              id="verifyToken"
              placeholder="Token webhook verificare"
              {...register('verifyToken', { required: 'Verify Token este obligatoriu' })}
            />
            {errors.verifyToken && (
              <p className="text-xs text-destructive">{errors.verifyToken.message}</p>
            )}
          </div>

          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="accessToken">Access Token *</Label>
            <Input
              id="accessToken"
              type="password"
              placeholder="Meta App Access Token"
              {...register('accessToken', { required: 'Access Token este obligatoriu' })}
            />
            {errors.accessToken && (
              <p className="text-xs text-destructive">{errors.accessToken.message}</p>
            )}
          </div>

          <div className="md:col-span-2">
            {connectMut.isError && (
              <p className="mb-2 text-sm text-destructive">
                {connectMut.error instanceof ApiError
                  ? connectMut.error.message
                  : 'Eroare la conectare'}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting || connectMut.isPending}>
              {connectMut.isPending ? 'Se conectează…' : 'Conectează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function SendMessageForm({
  accounts,
  onDone,
}: {
  accounts: Array<{ id: string; phoneNumberId: string; displayName?: string | null }>;
  onDone: () => void;
}): JSX.Element {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<SendWhatsAppDto>();

  const sendMut = useMutation({
    mutationFn: (dto: SendWhatsAppDto) => whatsappApi.sendMessage(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['whatsapp', 'messages'] });
      reset();
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Trimite mesaj WhatsApp</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => sendMut.mutate(v))}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="sendToNumber">Număr destinatar * (format E.164)</Label>
            <Input
              id="sendToNumber"
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

          {accounts.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="sendAccountId">Cont (opțional)</Label>
              <select
                id="sendAccountId"
                {...register('accountId')}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">— cont implicit —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName ?? a.phoneNumberId}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="sendBody">Mesaj *</Label>
            <textarea
              id="sendBody"
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
                {sendMut.error instanceof ApiError
                  ? sendMut.error.message
                  : 'Eroare la trimitere'}
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
