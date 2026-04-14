import { createRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface WorkflowStep {
  id: string;
  order: number;
  actionType: 'SEND_EMAIL' | 'CREATE_TASK' | 'ADD_NOTE' | 'WAIT_DAYS';
  actionConfig: Record<string, unknown>;
}

interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  trigger: string;
  triggerConfig: Record<string, unknown>;
  steps: WorkflowStep[];
  createdAt: string;
}

interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

const workflowsApi = {
  list: () => api.get<CursorPage<Workflow>>('/workflows'),
  toggle: (id: string, isActive: boolean) =>
    api.patch<Workflow>(`/workflows/${id}`, { isActive }),
  remove: (id: string) => api.delete<void>(`/workflows/${id}`),
};

export const workflowsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/workflows',
  component: WorkflowsPage,
});

const ACTION_LABELS: Record<string, string> = {
  SEND_EMAIL: 'Trimite email',
  CREATE_TASK: 'Crează task',
  ADD_NOTE: 'Adaugă notă',
  WAIT_DAYS: 'Așteaptă zile',
};

const TRIGGER_LABELS: Record<string, string> = {
  DEAL_CREATED: 'Deal creat',
  DEAL_STAGE_CHANGED: 'Deal mutat în etapă',
  CONTACT_CREATED: 'Contact creat',
  COMPANY_CREATED: 'Companie creată',
};

function WorkflowsPage(): JSX.Element {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: () => workflowsApi.list(),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      workflowsApi.toggle(id, isActive),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => workflowsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workflows'] }),
  });

  const workflows = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Automatizări (Workflows)</h1>
        <p className="text-sm text-muted-foreground">
          Crează workflow-uri via API — UI builder în S20 polish.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}

      {!isLoading && workflows.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Niciun workflow. Crează unul via{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">POST /api/v1/workflows</code>.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4">
        {workflows.map((wf) => (
          <Card key={wf.id} className={wf.isActive ? '' : 'opacity-60'}>
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base">{wf.name}</CardTitle>
                  {wf.description && (
                    <p className="mt-1 text-sm text-muted-foreground">{wf.description}</p>
                  )}
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => toggleMut.mutate({ id: wf.id, isActive: !wf.isActive })}
                  >
                    {wf.isActive ? 'Dezactivează' : 'Activează'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => {
                      if (confirm('Ștergi acest workflow?')) removeMut.mutate(wf.id);
                    }}
                  >
                    Șterge
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>
                <span className="text-muted-foreground">Trigger: </span>
                <span className="font-medium">{TRIGGER_LABELS[wf.trigger] ?? wf.trigger}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Pași ({wf.steps.length}): </span>
                {wf.steps.map((s, i) => (
                  <span key={s.id} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground mx-1">→</span>}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {ACTION_LABELS[s.actionType] ?? s.actionType}
                    </span>
                  </span>
                ))}
                {wf.steps.length === 0 && <span className="text-muted-foreground">(fără pași)</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
