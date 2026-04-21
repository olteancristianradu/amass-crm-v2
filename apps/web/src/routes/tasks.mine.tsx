import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { authedRoute } from './authed';
import { tasksApi } from '@/features/tasks/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Task, TaskStatus } from '@/lib/types';
import { QueryError } from '@/components/ui/QueryError';

export const tasksMineRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/tasks',
  component: TasksMinePage,
});

function TasksMinePage(): JSX.Element {
  const qc = useQueryClient();
  const [status, setStatus] = useState<TaskStatus>('OPEN');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['tasks', 'mine', { status }],
    queryFn: () => tasksApi.listMine({ status, limit: 100 }),
  });

  // L-4: optimistic updates so checking / unchecking a task feels instant.
  // Since we filter by status, flipping the status removes the row from the
  // current tab immediately — server resync happens in the background.
  const completeMut = useMutation({
    mutationFn: (id: string) => tasksApi.complete(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] });
      for (const [key, list] of prev) {
        if (!list) continue;
        qc.setQueryData<Task[]>(key, list.filter((t) => t.id !== id));
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, list] of ctx?.prev ?? []) qc.setQueryData(key, list);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const reopenMut = useMutation({
    mutationFn: (id: string) => tasksApi.reopen(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] });
      for (const [key, list] of prev) {
        if (!list) continue;
        qc.setQueryData<Task[]>(key, list.filter((t) => t.id !== id));
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, list] of ctx?.prev ?? []) qc.setQueryData(key, list);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  const removeMut = useMutation({
    mutationFn: (id: string) => tasksApi.remove(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['tasks'] });
      const prev = qc.getQueriesData<Task[]>({ queryKey: ['tasks'] });
      for (const [key, list] of prev) {
        if (!list) continue;
        qc.setQueryData<Task[]>(key, list.filter((t) => t.id !== id));
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      for (const [key, list] of ctx?.prev ?? []) qc.setQueryData(key, list);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Task-urile mele</h1>
        <div className="flex gap-1 rounded-md border p-1">
          <TabButton active={status === 'OPEN'} onClick={() => setStatus('OPEN')}>
            Deschise
          </TabButton>
          <TabButton active={status === 'DONE'} onClick={() => setStatus('DONE')}>
            Finalizate
          </TabButton>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={isError} error={error} label="Nu am putut încărca taskurile." />
      {data && data.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {status === 'OPEN' ? 'Niciun task deschis.' : 'Niciun task finalizat.'}
        </p>
      )}

      <div className="space-y-2">
        {data?.data.map((t) => (
          <TaskCard
            key={t.id}
            task={t}
            onComplete={() => completeMut.mutate(t.id)}
            onReopen={() => reopenMut.mutate(t.id)}
            onDelete={() => removeMut.mutate(t.id)}
            pending={completeMut.isPending || reopenMut.isPending || removeMut.isPending}
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
    <Card>
      <CardContent className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${task.status === 'DONE' ? 'line-through text-muted-foreground' : ''}`}>
            {task.title}
          </p>
          {task.description && (
            <p className="text-sm text-muted-foreground">{task.description}</p>
          )}
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {task.dueAt && (
              <span className={isOverdue ? 'font-medium text-destructive' : ''}>
                Termen: {new Date(task.dueAt).toLocaleString('ro-RO')}
              </span>
            )}
            <span>Prioritate: {priorityLabel(task.priority)}</span>
            {task.dealId && <span>Deal: {task.dealId.slice(0, 8)}…</span>}
            {task.subjectType && <span>{task.subjectType}</span>}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {task.status === 'OPEN' ? (
            <Button size="sm" variant="ghost" onClick={onComplete} disabled={pending}>
              Finalizează
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onReopen} disabled={pending}>
              Redeschide
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDelete} disabled={pending}>
            Șterge
          </Button>
        </div>
      </CardContent>
    </Card>
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
      className={`rounded-sm px-3 py-1 text-xs font-medium transition-colors ${
        active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground'
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
