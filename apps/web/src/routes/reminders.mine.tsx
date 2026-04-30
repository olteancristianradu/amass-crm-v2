import { createRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Plus } from 'lucide-react';
import { useState } from 'react';
import { authedRoute } from './authed';
import { remindersApi, type CreateReminderInput } from '@/features/reminders/api';
import { companiesApi } from '@/features/companies/api';
import { contactsApi } from '@/features/contacts/api';
import { clientsApi } from '@/features/clients/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import type { SubjectType } from '@/lib/types';
import { QueryError } from '@/components/ui/QueryError';

export const remindersMineRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/reminders',
  component: RemindersMinePage,
});

function RemindersMinePage(): JSX.Element {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reminders', 'mine'],
    queryFn: () => remindersApi.listMine(undefined, 50),
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => remindersApi.dismiss(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders', 'mine'] }),
  });

  return (
    <div>
      <PageHeader
        title="Reminder-urile mele"
        subtitle="Memento-uri legate de companii, contacte, deal-uri sau task-uri."
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} className="mr-1.5" />
            Reminder nou
          </Button>
        }
      />

      {showCreate && <NewReminderForm onDone={() => setShowCreate(false)} />}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={isError} error={error} label="Nu am putut încărca remindere." />

      {data && data.data.length === 0 && !showCreate && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={Clock}
            title="Niciun reminder programat"
            description={'Apasă "Reminder nou" sus pentru a crea unul, sau adaugă din pagina unui contact, companie sau client.'}
          />
        </GlassCard>
      )}

      <div className="space-y-2">
        {data?.data.map((r) => (
          <GlassCard key={r.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium leading-tight">{r.title}</p>
                {r.body && (
                  <p className="mt-1 text-sm text-muted-foreground">{r.body}</p>
                )}
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {new Date(r.remindAt).toLocaleString('ro-RO')} · {r.subjectType}
                </p>
              </div>
              {r.status === 'PENDING' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dismiss.mutate(r.id)}
                  disabled={dismiss.isPending}
                >
                  Închide
                </Button>
              )}
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

function NewReminderForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [subjectType, setSubjectType] = useState<SubjectType>('CONTACT');
  const [subjectId, setSubjectId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  // Default 1 day from now in datetime-local format
  const defaultWhen = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 16);
  })();
  const [remindAt, setRemindAt] = useState(defaultWhen);

  // Load subjects of the chosen type for autocomplete dropdown.
  const subjects = useQuery({
    queryKey: ['reminder-subjects', subjectType],
    queryFn: async () => {
      if (subjectType === 'COMPANY') {
        const r = await companiesApi.list(undefined, 50);
        return r.data.map((c) => ({ id: c.id, label: c.name }));
      }
      if (subjectType === 'CONTACT') {
        const r = await contactsApi.list(undefined, 50);
        return r.data.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}` }));
      }
      const r = await clientsApi.list(undefined, 50);
      return r.data.map((c) => ({ id: c.id, label: `${c.firstName} ${c.lastName}` }));
    },
  });

  const createMut = useMutation({
    mutationFn: (input: { st: SubjectType; sid: string; dto: CreateReminderInput }) =>
      remindersApi.create(input.st, input.sid, input.dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['reminders'] });
      onDone();
    },
  });

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!title.trim() || !subjectId || !remindAt) return;
    const dto: CreateReminderInput = {
      title: title.trim(),
      remindAt: new Date(remindAt).toISOString(),
    };
    if (body.trim()) dto.body = body.trim();
    createMut.mutate({ st: subjectType, sid: subjectId, dto });
  }

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Reminder nou</h2>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="r-type">Legat de *</Label>
          <select
            id="r-type"
            value={subjectType}
            onChange={(e) => {
              setSubjectType(e.target.value as SubjectType);
              setSubjectId('');
            }}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="CONTACT">Contact</option>
            <option value="COMPANY">Companie</option>
            <option value="CLIENT">Client (B2C)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-subject">Selectează *</Label>
          <select
            id="r-subject"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            required
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">— alege —</option>
            {subjects.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {subjects.data && subjects.data.length === 0 && (
            <p className="text-xs text-muted-foreground">
              Nu există încă. Creează unul în pagina respectivă întâi.
            </p>
          )}
        </div>
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="r-title">Titlu *</Label>
          <Input
            id="r-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Sună înapoi pentru ofertă"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-when">Când *</Label>
          <Input
            id="r-when"
            type="datetime-local"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="r-body">Note (opțional)</Label>
          <Input
            id="r-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Detalii suplimentare"
          />
        </div>
        <div className="md:col-span-2">
          {createMut.isError && (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {createMut.error instanceof Error ? createMut.error.message : 'Eroare la salvare'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>
              Anulează
            </Button>
            <Button
              type="submit"
              disabled={!title.trim() || !subjectId || createMut.isPending}
            >
              {createMut.isPending ? 'Se programează…' : 'Programează'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}
