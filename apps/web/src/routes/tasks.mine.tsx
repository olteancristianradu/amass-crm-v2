import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { CheckSquare, Plus, Trash2 } from 'lucide-react';
import { authedRoute } from './authed';
import { tasksApi, type CreateTaskInput } from '@/features/tasks/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { ListSkeleton } from '@/components/ui/loading-skeleton';
import type { Task, TaskPriority, TaskStatus } from '@/lib/types';
import { QueryError } from '@/components/ui/QueryError';

export const tasksMineRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/tasks',
  component: TasksMinePage,
});

function TasksMinePage(): JSX.Element {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TaskStatus>('OPEN');
  const [showCreate, setShowCreate] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['tasks', 'mine', { status }],
    queryFn: () => tasksApi.listMine({ status, limit: 100 }),
  });

  // Optimistic mutations — checking/unchecking flips the row out instantly.
  // Each mutation does the same thing (remove the matching row from every
  // ['tasks', ...] cache, refetch on settle) but rules-of-hooks forbids
  // factoring into a helper, so we inline.
  function optimisticRemove<TVars>(
    fn: (vars: TVars) => Promise<unknown>,
    pickId: (vars: TVars) => string,
  ) {
    return {
      mutationFn: fn,
      onMutate: async (vars: TVars) => {
        const id = pickId(vars);
        await qc.cancelQueries({ queryKey: ['tasks'] });
        const prev = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] });
        for (const [key, list] of prev) {
          if (!list) continue;
          qc.setQueryData<Task[]>(key, list.filter((t) => t.id !== id));
        }
        return { prev };
      },
      onError: (_e: unknown, _v: TVars, ctx: { prev: [unknown, Task[] | undefined][] } | undefined) => {
        for (const [key, list] of ctx?.prev ?? []) {
          qc.setQueryData(key as readonly unknown[], list);
        }
      },
      onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
    };
  }
  const completeMut = useMutation(
    optimisticRemove((id: string) => tasksApi.complete(id), (id) => id),
  );
  const reopenMut = useMutation(
    optimisticRemove((id: string) => tasksApi.reopen(id), (id) => id),
  );
  const removeMut = useMutation(
    optimisticRemove((id: string) => tasksApi.remove(id), (id) => id),
  );

  const pending = completeMut.isPending || reopenMut.isPending || removeMut.isPending;

  return (
    <div>
      <PageHeader
        title="Task-urile mele"
        subtitle="Sarcinile asignate ție — comută între deschise și finalizate."
        actions={
          <div className="flex items-center gap-2">
            <div className="flex gap-1 rounded-md border border-border/70 bg-card/70 p-1">
              <TabButton active={status === 'OPEN'} onClick={() => setStatus('OPEN')}>
                Deschise
              </TabButton>
              <TabButton active={status === 'DONE'} onClick={() => setStatus('DONE')}>
                Finalizate
              </TabButton>
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={14} className="mr-1.5" />
              Task nou
            </Button>
          </div>
        }
      />

      {showCreate && <NewTaskForm onDone={() => setShowCreate(false)} />}

      {isLoading && <ListSkeleton rows={5} />}
      <QueryError isError={isError} error={error} label="Nu am putut încărca taskurile." />

      {data && data.data.length === 0 && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={CheckSquare}
            title={status === 'OPEN' ? 'Niciun task deschis' : 'Niciun task finalizat'}
            description={
              status === 'OPEN'
                ? 'Nimic de făcut acum. Mergi la un deal sau companie și creează un task de acolo.'
                : 'Niciun task încheiat încă. Comută la "Deschise" pentru lista activă.'
            }
          />
        </GlassCard>
      )}

      <div className="space-y-2">
        {data?.data.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onComplete={() => completeMut.mutate(t.id)}
            onReopen={() => reopenMut.mutate(t.id)}
            onDelete={() => removeMut.mutate(t.id)}
            pending={pending}
          />
        ))}
      </div>
    </div>
  );
}

interface TaskCardProps {
  task: Task;
  onComplete: () => void;
  onReopen: () => void;
  onDelete: () => void;
  pending: boolean;
}

function TaskCard({ task, onComplete, onReopen, onDelete, pending }: TaskCardProps): JSX.Element {
  const isOverdue = task.dueAt && task.status === 'OPEN' && new Date(task.dueAt) < new Date();
  return (
    <GlassCard className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p
            className={`font-medium leading-tight ${
              task.status === 'DONE' ? 'line-through text-muted-foreground' : ''
            }`}
          >
            {task.title}
          </p>
          {task.description && (
            <p className="mt-1 text-sm text-muted-foreground">{task.description}</p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {task.dueAt && (
              <span className={isOverdue ? 'font-medium text-destructive' : ''}>
                Termen: {new Date(task.dueAt).toLocaleString('ro-RO')}
              </span>
            )}
            <span>Prioritate: {priorityLabel(task.priority)}</span>
            {task.dealId && <span className="font-mono">Deal: {task.dealId.slice(0, 8)}…</span>}
            {task.subjectType && <span>{task.subjectType}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {task.status === 'OPEN' ? (
            <Button size="sm" variant="outline" onClick={onComplete} disabled={pending}>
              Finalizează
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onReopen} disabled={pending}>
              Redeschide
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDelete} disabled={pending} aria-label="Șterge task">
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </GlassCard>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      {children}
    </button>
  );
}

function priorityLabel(p: Task['priority']): string {
  switch (p) {
    case 'LOW':
      return 'Scăzută';
    case 'NORMAL':
      return 'Normală';
    case 'HIGH':
      return 'Ridicată';
  }
}

function NewTaskForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('NORMAL');
  const [dueAt, setDueAt] = useState('');

  const createMut = useMutation({
    mutationFn: (dto: CreateTaskInput) => tasksApi.create(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['tasks'] });
      onDone();
    },
  });

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!title.trim()) return;
    const dto: CreateTaskInput = {
      title: title.trim(),
      priority,
    };
    if (description.trim()) dto.description = description.trim();
    if (dueAt) dto.dueAt = new Date(dueAt).toISOString();
    createMut.mutate(dto);
  }

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Task nou</h2>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="task-title">Titlu *</Label>
          <Input
            id="task-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Ex: Sună clientul X la ora 15"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-priority">Prioritate</Label>
          <select
            id="task-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="LOW">Scăzută</option>
            <option value="NORMAL">Normală</option>
            <option value="HIGH">Ridicată</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="task-due">Termen (opțional)</Label>
          <Input
            id="task-due"
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
          />
        </div>
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="task-description">Descriere (opțional)</Label>
          <Input
            id="task-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
            <Button type="submit" disabled={!title.trim() || createMut.isPending}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}
