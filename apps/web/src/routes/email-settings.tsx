import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { emailAccountsApi } from '@/features/email/api';
import type { CreateEmailAccountInput } from '@/features/email/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const emailSettingsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/email-settings',
  component: EmailSettingsPage,
});

function EmailSettingsPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['email-accounts'],
    queryFn: () => emailAccountsApi.list(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => emailAccountsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-accounts'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Setări email</h1>
        <Button onClick={() => setShowForm(!showForm)}>
          {showForm ? 'Anulează' : 'Adaugă cont'}
        </Button>
      </div>

      {showForm && (
        <AddAccountForm
          onSuccess={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['email-accounts'] });
          }}
        />
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {accounts && accounts.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">
          Niciun cont de email configurat. Adaugă unul pentru a putea trimite
          email-uri din CRM.
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {accounts?.map((a) => (
          <Card key={a.id}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-base">
                <span>{a.label}</span>
                {a.isDefault && (
                  <span className="rounded-sm bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Implicit
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <span className="text-muted-foreground">De la:</span>{' '}
                {a.fromName} &lt;{a.fromEmail}&gt;
              </p>
              <p>
                <span className="text-muted-foreground">SMTP:</span>{' '}
                {a.smtpHost}:{a.smtpPort} ({a.smtpSecure ? 'TLS' : 'STARTTLS'})
              </p>
              <p>
                <span className="text-muted-foreground">User:</span> {a.smtpUser}
              </p>
              <div className="pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => deleteMut.mutate(a.id)}
                  disabled={deleteMut.isPending}
                >
                  Șterge
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function AddAccountForm({ onSuccess }: { onSuccess: () => void }): JSX.Element {
  const [form, setForm] = useState<CreateEmailAccountInput>({
    label: '',
    smtpHost: '',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: '',
    smtpPass: '',
    fromName: '',
    fromEmail: '',
    isDefault: true,
  });

  const createMut = useMutation({
    mutationFn: () => emailAccountsApi.create(form),
    onSuccess,
  });

  const set = <K extends keyof CreateEmailAccountInput>(key: K, val: CreateEmailAccountInput[K]) =>
    setForm((f) => ({ ...f, [key]: val }));

  return (
    <Card>
      <CardContent className="pt-6">
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            createMut.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="ea-label">Etichetă</Label>
            <Input
              id="ea-label"
              placeholder="ex: Gmail profesional"
              value={form.label}
              onChange={(e) => set('label', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ea-from-name">Nume expeditor</Label>
            <Input
              id="ea-from-name"
              placeholder="Andrei Popescu"
              value={form.fromName}
              onChange={(e) => set('fromName', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ea-from-email">Email expeditor</Label>
            <Input
              id="ea-from-email"
              type="email"
              placeholder="andrei@firma.ro"
              value={form.fromEmail}
              onChange={(e) => set('fromEmail', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ea-smtp-host">Server SMTP</Label>
            <Input
              id="ea-smtp-host"
              placeholder="smtp.gmail.com"
              value={form.smtpHost}
              onChange={(e) => set('smtpHost', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ea-smtp-port">Port SMTP</Label>
            <Input
              id="ea-smtp-port"
              type="number"
              value={form.smtpPort}
              onChange={(e) => set('smtpPort', Number(e.target.value))}
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              id="ea-smtp-secure"
              type="checkbox"
              checked={form.smtpSecure}
              onChange={(e) => set('smtpSecure', e.target.checked)}
            />
            <Label htmlFor="ea-smtp-secure">TLS implicit (port 465)</Label>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ea-smtp-user">Utilizator SMTP</Label>
            <Input
              id="ea-smtp-user"
              placeholder="andrei@firma.ro"
              value={form.smtpUser}
              onChange={(e) => set('smtpUser', e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ea-smtp-pass">Parolă SMTP</Label>
            <Input
              id="ea-smtp-pass"
              type="password"
              placeholder="App password"
              value={form.smtpPass}
              onChange={(e) => set('smtpPass', e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            {createMut.isError && (
              <p className="mb-2 text-xs text-destructive">
                Eroare: {createMut.error instanceof Error ? createMut.error.message : 'necunoscută'}
              </p>
            )}
            <Button
              type="submit"
              disabled={
                createMut.isPending ||
                !form.label.trim() ||
                !form.smtpHost.trim() ||
                !form.smtpUser.trim() ||
                !form.smtpPass.trim() ||
                !form.fromName.trim() ||
                !form.fromEmail.trim()
              }
            >
              Salvează cont
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
