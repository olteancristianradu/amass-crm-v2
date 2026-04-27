import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Mail, Plus, Trash2 } from 'lucide-react';
import { authedRoute } from './authed';
import { emailAccountsApi } from '@/features/email/api';
import type { CreateEmailAccountInput } from '@/features/email/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import { EmptyState, PageHeader, StatusBadge } from '@/components/ui/page-header';

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
    <div>
      <PageHeader
        title="Setări email"
        subtitle="Conturi SMTP folosite pentru a trimite email-uri din CRM (notificări, secvențe, transactional)."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Adaugă cont'}
          </Button>
        }
      />

      {showForm && (
        <AddAccountForm
          onSuccess={() => {
            setShowForm(false);
            qc.invalidateQueries({ queryKey: ['email-accounts'] });
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {accounts && accounts.length === 0 && !showForm && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={Mail}
            title="Niciun cont configurat"
            description="Adaugă un cont SMTP pentru a putea trimite email-uri din CRM. Funcționează cu Gmail (app password), Office 365, sau orice furnizor SMTP standard."
            action={
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus size={14} className="mr-1.5" /> Adaugă cont
              </Button>
            }
          />
        </GlassCard>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {accounts?.map((a) => (
          <GlassCard key={a.id} className="p-5">
            <div className="mb-3 flex items-start justify-between gap-2">
              <h3 className="font-medium">{a.label}</h3>
              {a.isDefault && <StatusBadge tone="green">Implicit</StatusBadge>}
            </div>
            <dl className="space-y-1.5 text-sm">
              <FieldRow label="De la" value={`${a.fromName} <${a.fromEmail}>`} />
              <FieldRow
                label="SMTP"
                value={`${a.smtpHost}:${a.smtpPort} (${a.smtpSecure ? 'TLS' : 'STARTTLS'})`}
                mono
              />
              <FieldRow label="User" value={a.smtpUser} mono />
            </dl>
            <div className="mt-4 flex justify-end border-t border-border/40 pt-3">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => deleteMut.mutate(a.id)}
                disabled={deleteMut.isPending}
              >
                <Trash2 size={14} className="mr-1.5" />
                Șterge
              </Button>
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'text-right font-mono text-xs tabular-nums' : 'text-right font-medium'}>
        {value}
      </dd>
    </div>
  );
}

function AddAccountForm({
  onSuccess,
  onCancel,
}: {
  onSuccess: () => void;
  onCancel: () => void;
}): JSX.Element {
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

  const set = <K extends keyof CreateEmailAccountInput>(
    key: K,
    val: CreateEmailAccountInput[K],
  ) => setForm((f) => ({ ...f, [key]: val }));

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Cont SMTP nou</h2>
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          createMut.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="ea-label">Etichetă</Label>
          <Input
            id="ea-label"
            placeholder="ex: Gmail profesional"
            value={form.label}
            onChange={(e) => set('label', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ea-from-name">Nume expeditor</Label>
          <Input
            id="ea-from-name"
            placeholder="Andrei Popescu"
            value={form.fromName}
            onChange={(e) => set('fromName', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ea-from-email">Email expeditor</Label>
          <Input
            id="ea-from-email"
            type="email"
            placeholder="andrei@firma.ro"
            value={form.fromEmail}
            onChange={(e) => set('fromEmail', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ea-smtp-host">Server SMTP</Label>
          <Input
            id="ea-smtp-host"
            placeholder="smtp.gmail.com"
            value={form.smtpHost}
            onChange={(e) => set('smtpHost', e.target.value)}
            className="font-mono text-xs"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ea-smtp-port">Port SMTP</Label>
          <Input
            id="ea-smtp-port"
            type="number"
            className="tabular-nums"
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
          <Label htmlFor="ea-smtp-secure" className="cursor-pointer">
            TLS implicit (port 465)
          </Label>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ea-smtp-user">Utilizator SMTP</Label>
          <Input
            id="ea-smtp-user"
            placeholder="andrei@firma.ro"
            value={form.smtpUser}
            onChange={(e) => set('smtpUser', e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
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
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              Eroare: {createMut.error instanceof Error ? createMut.error.message : 'necunoscută'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Anulează
            </Button>
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
        </div>
      </form>
    </GlassCard>
  );
}
