/**
 * CommandPaletteActions — inline "safe actions" mode of the global Cmd-K palette.
 *
 * Replaces the search results panel when the user picks one of:
 *   • Adaugă task
 *   • Înregistrează apel
 *   • Trimite email
 *
 * Each action is a small form rendered inside the palette modal:
 *   1. Click action → palette switches to action mode
 *   2. User fills minimal fields
 *   3. Click "Confirmă" → POST to API; on success → toast + close
 *
 * Audit log entries are created automatically server-side by the
 * respective controllers (tasks, activities, email). No client-side
 * audit calls are needed — this avoids a write-skew where the audit
 * row exists but the operation didn't.
 */
import * as React from 'react';
import { CheckCircle2, Loader2, Mail, Phone, PlusCircle, X } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToastStore } from '@/stores/toasts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export type PaletteActionKey = 'task' | 'call' | 'email';

export const PALETTE_ACTIONS: Array<{
  key: PaletteActionKey;
  label: string;
  hint: string;
  icon: typeof PlusCircle;
}> = [
  { key: 'task', label: 'Adaugă task', hint: 'Creează un task nou cu titlu și termen', icon: PlusCircle },
  { key: 'call', label: 'Înregistrează apel', hint: 'Loghează un apel scurt cu o notă', icon: Phone },
  { key: 'email', label: 'Trimite email', hint: 'Compune un email rapid către un destinatar', icon: Mail },
];

interface Props {
  action: PaletteActionKey;
  onDone: () => void;
  onCancel: () => void;
}

export function PaletteActionForm({ action, onDone, onCancel }: Props): JSX.Element {
  if (action === 'task') return <TaskForm onDone={onDone} onCancel={onCancel} />;
  if (action === 'call') return <CallForm onDone={onDone} onCancel={onCancel} />;
  return <EmailForm onDone={onDone} onCancel={onCancel} />;
}

function TaskForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }): JSX.Element {
  const [title, setTitle] = React.useState('');
  const [dueAt, setDueAt] = React.useState('');
  const push = useToastStore((s) => s.push);

  const mut = useMutation({
    mutationFn: () =>
      api.post('/tasks', {
        title: title.trim(),
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
      }),
    onSuccess: () => {
      push({ title: 'Task adăugat', body: title.trim() });
      onDone();
    },
    onError: (e) => {
      push({ title: 'Eroare', body: e instanceof Error ? e.message : 'Necunoscută' });
    },
  });

  return (
    <ActionShell
      icon={PlusCircle}
      title="Adaugă task"
      description="Creează rapid un task. Apare în lista ta personală de task-uri."
      submitLabel="Confirmă"
      submitDisabled={!title.trim() || mut.isPending}
      submitting={mut.isPending}
      onSubmit={() => mut.mutate()}
      onCancel={onCancel}
    >
      <div className="space-y-2">
        <Label htmlFor="pa-title">Titlu *</Label>
        <Input
          id="pa-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ex: Sună înapoi Acme SRL"
          autoFocus
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pa-due">Termen (opțional)</Label>
        <Input
          id="pa-due"
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
      </div>
    </ActionShell>
  );
}

function CallForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }): JSX.Element {
  const [phone, setPhone] = React.useState('');
  const [note, setNote] = React.useState('');
  const push = useToastStore((s) => s.push);

  // Log a manual call as an Activity with action=call.logged. Avoids the
  // heavier /calls endpoint that requires Twilio integration.
  const mut = useMutation({
    mutationFn: () =>
      api.post('/activities', {
        subjectType: 'CONTACT',
        // Manual call without a linked entity — backend accepts a synthetic
        // subjectId 'manual'. The activity feed renders this with a generic
        // icon and the note as the body.
        subjectId: 'manual',
        action: 'call.logged',
        metadata: { phone: phone.trim() || undefined, note: note.trim() || undefined },
      }),
    onSuccess: () => {
      push({ title: 'Apel înregistrat', body: phone.trim() || 'fără număr' });
      onDone();
    },
    onError: (e) => {
      push({ title: 'Eroare', body: e instanceof Error ? e.message : 'Necunoscută' });
    },
  });

  return (
    <ActionShell
      icon={Phone}
      title="Înregistrează apel"
      description="Notă rapidă pentru un apel efectuat. Apare în jurnal."
      submitLabel="Confirmă"
      submitDisabled={!phone.trim() && !note.trim() || mut.isPending}
      submitting={mut.isPending}
      onSubmit={() => mut.mutate()}
      onCancel={onCancel}
    >
      <div className="space-y-2">
        <Label htmlFor="pa-phone">Telefon</Label>
        <Input
          id="pa-phone"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+40700000000"
          autoFocus
          inputMode="tel"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pa-note">Notă (opțional)</Label>
        <Input
          id="pa-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Despre ce a fost discuția"
        />
      </div>
    </ActionShell>
  );
}

function EmailForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }): JSX.Element {
  const [to, setTo] = React.useState('');
  const [subject, setSubject] = React.useState('');
  const [body, setBody] = React.useState('');
  const push = useToastStore((s) => s.push);

  const mut = useMutation({
    mutationFn: () =>
      api.post('/emails/send', {
        to: [to.trim()],
        subject: subject.trim(),
        bodyHtml: `<p>${escapeHtml(body.trim())}</p>`,
      }),
    onSuccess: () => {
      push({ title: 'Email trimis', body: to.trim() });
      onDone();
    },
    onError: (e) => {
      push({ title: 'Eroare', body: e instanceof Error ? e.message : 'Necunoscută' });
    },
  });

  return (
    <ActionShell
      icon={Mail}
      title="Trimite email"
      description="Email scurt prin contul tău conectat. Verifică detaliile înainte de confirmare."
      submitLabel="Confirmă și trimite"
      submitDisabled={!isEmail(to) || !subject.trim() || !body.trim() || mut.isPending}
      submitting={mut.isPending}
      onSubmit={() => mut.mutate()}
      onCancel={onCancel}
    >
      <div className="space-y-2">
        <Label htmlFor="pa-to">Către *</Label>
        <Input
          id="pa-to"
          type="email"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="andrei@firma.ro"
          autoFocus
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pa-subject">Subiect *</Label>
        <Input
          id="pa-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="pa-body">Mesaj *</Label>
        <textarea
          id="pa-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    </ActionShell>
  );
}

function ActionShell({
  icon: Icon,
  title,
  description,
  submitLabel,
  submitDisabled,
  submitting,
  onSubmit,
  onCancel,
  children,
}: {
  icon: typeof PlusCircle;
  title: string;
  description: string;
  submitLabel: string;
  submitDisabled: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitDisabled) onSubmit();
      }}
      className="space-y-4 p-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Anulează acțiunea"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
        >
          <X size={14} />
        </button>
      </div>

      <div className="space-y-3">{children}</div>

      <div className="flex justify-end gap-2 border-t border-border/60 pt-3">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Anulează
        </Button>
        <Button type="submit" size="sm" disabled={submitDisabled}>
          {submitting ? (
            <>
              <Loader2 size={14} className="mr-1.5 animate-spin" />
              Se trimite…
            </>
          ) : (
            <>
              <CheckCircle2 size={14} className="mr-1.5" />
              {submitLabel}
            </>
          )}
        </Button>
      </div>
    </form>
  );
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
