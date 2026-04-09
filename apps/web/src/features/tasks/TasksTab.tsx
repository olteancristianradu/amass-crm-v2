import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { tasksApi } from './api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { SubjectType, TaskPriority } from '@/lib/types';

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

/**
 * Tab shown inside a Company/Contact/Client detail page — renders the
 * OPEN tasks for that subject plus a tiny inline "add task" form. The
 * /app/tasks page is the standalone "my tasks" view with a broader
 * filter UI; this tab is the focused, contextual variant.
 */
export function TasksTab({ subjectType, subjectId }: Props): JSX.Element {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', { subjectType, subjectId }],
    queryFn: () => tasksApi.list({ subjectType, subjectId, limit: 50 }),
  });

  const createMut = useMutation({
    mutationFn: () =>
      tasksApi.create({
        title,
        subjectType,
        subjectId,
        priority,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      setTitle('');
      setDueAt('');
      setPriority('NORMAL');
    },
  });

  const completeMut = useMutation({
    mutationFn: (id: string) => tasksApi.complete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  return (
    <div className="space-y-4 pt-4">
      <form
        className="grid gap-2 md:grid-cols-[1fr_160px_120px_auto]"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim()) createMut.mutate();
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="task-title" className="sr-only">
            Titlu
          </Label>
          <Input
            id="task-title"
            placeholder="Titlu task…"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <Input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
        />
        <select
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          value={priority}
          onChange={(e) => setPriority(e.target.value as TaskPriority)}
        >
          <option value="LOW">Scăzută</option>
          <option value="NORMAL">Normală</option>
          <option value="HIGH">Ridicată</option>
        </select>
        <Button type="submit" disabled={createMut.isPending || !title.trim()}>
          Adaugă
        </Button>
      </form>

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {data && data.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Niciun task.</p>
      )}

      <ul className="divide-y">
        {data?.data.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <div>
              <p
                className={`text-sm font-medium ${
                  t.status === 'DONE' ? 'text-muted-foreground line-through' : ''
                }`}
              >
                {t.title}
              </p>
              {t.dueAt && (
                <p className="text-xs text-muted-foreground">
                  {new Date(t.dueAt).toLocaleString('ro-RO')} · {t.priority}
                </p>
              )}
            </div>
            {t.status === 'OPEN' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => completeMut.mutate(t.id)}
                disabled={completeMut.isPending}
              >
                ✓
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
