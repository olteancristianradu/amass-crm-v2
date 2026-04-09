import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { remindersApi } from './api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { SubjectType } from '@/lib/types';
import { ApiError } from '@/lib/api';

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

export function RemindersTab({ subjectType, subjectId }: Props): JSX.Element {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [remindAt, setRemindAt] = useState(defaultRemindAt());
  const [formError, setFormError] = useState<string | null>(null);

  const listQ = useQuery({
    queryKey: ['reminders', subjectType, subjectId],
    queryFn: () => remindersApi.listForSubject(subjectType, subjectId),
  });

  const create = useMutation({
    mutationFn: () =>
      remindersApi.create(subjectType, subjectId, {
        title: title.trim(),
        body: body.trim() || undefined,
        // Input type="datetime-local" gives us "YYYY-MM-DDTHH:mm" in local time.
        // Converting via new Date() keeps the user's local zone, then toISOString.
        remindAt: new Date(remindAt).toISOString(),
      }),
    onSuccess: async () => {
      setTitle('');
      setBody('');
      setRemindAt(defaultRemindAt());
      setFormError(null);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['reminders', subjectType, subjectId] }),
        qc.invalidateQueries({ queryKey: ['timeline', subjectType, subjectId] }),
        qc.invalidateQueries({ queryKey: ['reminders', 'mine'] }),
      ]);
    },
    onError: (err) => {
      setFormError(err instanceof ApiError ? err.message : 'Eroare la salvare');
    },
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => remindersApi.dismiss(id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['reminders', subjectType, subjectId] }),
        qc.invalidateQueries({ queryKey: ['reminders', 'mine'] }),
      ]);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => remindersApi.remove(id),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['reminders', subjectType, subjectId] }),
        qc.invalidateQueries({ queryKey: ['reminders', 'mine'] }),
      ]);
    },
  });

  return (
    <div className="space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          create.mutate();
        }}
        className="grid gap-3 md:grid-cols-2"
      >
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="r-title">Titlu *</Label>
          <Input
            id="r-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sună decision-maker-ul"
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="r-body">Note</Label>
          <Textarea
            id="r-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="r-when">Când *</Label>
          <Input
            id="r-when"
            type="datetime-local"
            value={remindAt}
            onChange={(e) => setRemindAt(e.target.value)}
          />
        </div>
        <div className="flex items-end">
          <Button type="submit" disabled={create.isPending || !title.trim()}>
            {create.isPending ? 'Se salvează…' : 'Programează reminder'}
          </Button>
        </div>
        {formError && <p className="text-sm text-destructive md:col-span-2">{formError}</p>}
      </form>

      {listQ.isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {listQ.data && listQ.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Niciun reminder programat.</p>
      )}
      <ul className="space-y-2">
        {listQ.data?.map((r) => (
          <li key={r.id} className="rounded-md border bg-background p-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{r.title}</span>
                  <StatusBadge status={r.status} />
                </div>
                {r.body && <p className="mt-1 text-sm text-muted-foreground">{r.body}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(r.remindAt).toLocaleString('ro-RO')}
                </p>
              </div>
              <div className="flex gap-1">
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove.mutate(r.id)}
                  disabled={remove.isPending}
                >
                  Șterge
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const cls: Record<string, string> = {
    PENDING: 'bg-amber-100 text-amber-900',
    FIRED: 'bg-green-100 text-green-900',
    DISMISSED: 'bg-slate-100 text-slate-700',
    CANCELLED: 'bg-slate-100 text-slate-500 line-through',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls[status] ?? ''}`}>
      {status}
    </span>
  );
}

function defaultRemindAt(): string {
  // +1 hour from now, formatted for <input type="datetime-local"> (local zone).
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
