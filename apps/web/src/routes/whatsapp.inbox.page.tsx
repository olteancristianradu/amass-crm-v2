import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { MessageCircle } from 'lucide-react';
import {
  whatsappApi,
  type ConnectAccountDto,
  type SendWhatsAppDto,
} from '@/features/whatsapp/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { ApiError } from '@/lib/api';
import { statusBadgeClasses, type StatusTone } from '@/lib/status-colors';
import { useTour } from '@/lib/tours/useTour';

const MSG_DIRECTION_TONES: Record<string, StatusTone> = {
  INBOUND: 'info',
  OUTBOUND: 'success',
};

const MSG_STATUS_TONES: Record<string, StatusTone> = {
  QUEUED: 'neutral',
  SENT: 'info',
  DELIVERED: 'success',
  READ: 'success',
  FAILED: 'danger',
};

export function WhatsAppInboxPage(): JSX.Element {
  useTour('whatsapp-inbox');
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [showSendForm, setShowSendForm] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const { data: accountsData, isLoading: accountsLoading, isError: accountsError, error: accountsErr } = useQuery({
    queryKey: ['whatsapp', 'accounts'],
    queryFn: () => whatsappApi.listAccounts(),
  });

  const { data: messagesData, isLoading: messagesLoading, isError: messagesError, error: messagesErr } = useQuery({
    queryKey: ['whatsapp', 'messages', 'account', selectedAccountId],
    queryFn: () => whatsappApi.listMessagesByAccount(selectedAccountId),
    enabled: Boolean(selectedAccountId),
  });

  const accounts = accountsData ?? [];
  const messages = messagesData ?? [];

  return (
    <div className="space-y-4">
      <PageHeader
        title="WhatsApp"
        subtitle="Conversații cu clienții pe WhatsApp Business."
        actions={
          <>
            <Button variant="outline" onClick={() => setShowConnectForm((v) => !v)} data-tour="whatsapp-connect-btn">
              {showConnectForm ? 'Anulează' : '+ Conectează cont'}
            </Button>
            <Button onClick={() => setShowSendForm((v) => !v)} data-tour="whatsapp-send-btn">
              {showSendForm ? 'Anulează' : '+ Trimite mesaj'}
            </Button>
          </>
        }
      />

      {showConnectForm && <ConnectAccountForm onDone={() => setShowConnectForm(false)} />}
      {showSendForm && (
        <SendMessageForm
          onDone={() => setShowSendForm(false)}
        />
      )}

      {/* Accounts list */}
      {accountsLoading && <div className="animate-pulse h-8 bg-secondary rounded w-full" />}
      {accountsError && (
        <p className="text-red-500 text-sm">
          {accountsErr instanceof ApiError ? accountsErr.message : String(accountsErr)}
        </p>
      )}

      {accountsData && (
        <Card data-tour="whatsapp-accounts">
          <CardHeader>
            <CardTitle className="text-base">Conturi conectate ({accounts.length})</CardTitle>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Phone Number ID</th>
                  <th scope="col" className="px-4 py-2 font-medium">Nume afișat</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Creat</th>
                  <th scope="col" className="px-4 py-2 font-medium">Mesaje</th>
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
                    <td className="px-4 py-2">{a.displayPhoneNumber}</td>
                    <td className="px-4 py-2">
                      <span
                        className={statusBadgeClasses(a.isActive ? 'success' : 'neutral')}
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
          {messagesLoading && <div className="animate-pulse h-8 bg-secondary rounded w-full" />}
          {messagesError && (
            <p className="text-red-500 text-sm">
              {messagesErr instanceof ApiError ? messagesErr.message : String(messagesErr)}
            </p>
          )}

          {messagesData && messages.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Mesaje cont</CardTitle>
              </CardHeader>
              <EmptyState
                icon={MessageCircle}
                title="Niciun mesaj WhatsApp"
                description="Conversațiile WhatsApp Business vor apărea aici după ce conectezi un Meta WABA account."
              />
            </Card>
          ) : messagesData && (
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
                      <th scope="col" className="px-4 py-2 font-medium">Direcție</th>
                      <th scope="col" className="px-4 py-2 font-medium">De la</th>
                      <th scope="col" className="px-4 py-2 font-medium">Către</th>
                      <th scope="col" className="px-4 py-2 font-medium">Mesaj</th>
                      <th scope="col" className="px-4 py-2 font-medium">Status</th>
                      <th scope="col" className="px-4 py-2 font-medium">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map((m) => (
                      <tr key={m.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2">
                          <span
                            className={statusBadgeClasses(MSG_DIRECTION_TONES[m.direction] ?? 'neutral')}
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
                            className={statusBadgeClasses(MSG_STATUS_TONES[m.status] ?? 'neutral')}
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
            <Label htmlFor="displayPhoneNumber">Număr afișat *</Label>
            <Input
              id="displayPhoneNumber"
              placeholder="+40712345678"
              {...register('displayPhoneNumber', { required: 'Numărul afișat este obligatoriu' })}
            />
            {errors.displayPhoneNumber && (
              <p className="text-xs text-destructive">{errors.displayPhoneNumber.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="webhookVerifyToken">Verify Token *</Label>
            <Input
              id="webhookVerifyToken"
              placeholder="Token webhook verificare"
              {...register('webhookVerifyToken', { required: 'Verify Token este obligatoriu' })}
            />
            {errors.webhookVerifyToken && (
              <p className="text-xs text-destructive">{errors.webhookVerifyToken.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="metaAppSecret">Meta App Secret *</Label>
            <Input
              id="metaAppSecret"
              type="password"
              placeholder="App Secret din Meta Developer"
              {...register('metaAppSecret', { required: 'Meta App Secret este obligatoriu' })}
            />
            {errors.metaAppSecret && (
              <p className="text-xs text-destructive">{errors.metaAppSecret.message}</p>
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

function SendMessageForm({ onDone }: { onDone: () => void }): JSX.Element {
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

          <div className="space-y-1">
            <Label htmlFor="subjectType">Entitate *</Label>
            <select
              id="subjectType"
              {...register('subjectType', { required: 'Entitatea este obligatorie' })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="CLIENT">Client</option>
              <option value="CONTACT">Contact</option>
              <option value="COMPANY">Companie</option>
            </select>
            {errors.subjectType && (
              <p className="text-xs text-destructive">{errors.subjectType.message}</p>
            )}
          </div>

          <div className="space-y-1">
            <Label htmlFor="subjectId">ID entitate *</Label>
            <Input
              id="subjectId"
              placeholder="cuid client/contact/companie"
              {...register('subjectId', { required: 'ID-ul entității este obligatoriu' })}
            />
            {errors.subjectId && (
              <p className="text-xs text-destructive">{errors.subjectId.message}</p>
            )}
          </div>

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
