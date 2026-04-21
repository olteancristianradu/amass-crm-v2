import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { QueryError } from '@/components/ui/QueryError';

// ── Types ──────────────────────────────────────────────────────────────────────

type WorkflowTrigger = 'DEAL_CREATED' | 'DEAL_STAGE_CHANGED' | 'CONTACT_CREATED' | 'COMPANY_CREATED';
type ActionType = 'SEND_EMAIL' | 'CREATE_TASK' | 'ADD_NOTE' | 'WAIT_DAYS';

interface WorkflowStep {
  id: string;
  order: number;
  actionType: ActionType;
  actionConfig: Record<string, unknown>;
}

interface Workflow {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  trigger: WorkflowTrigger;
  triggerConfig: Record<string, unknown>;
  steps: WorkflowStep[];
  createdAt: string;
}

interface DraftStep {
  actionType: ActionType;
  actionConfig: Record<string, string>;
}

interface CursorPage<T> { data: T[]; nextCursor: string | null }

// ── API ────────────────────────────────────────────────────────────────────────

const workflowsApi = {
  list: () => api.get<CursorPage<Workflow>>('/workflows'),
  create: (dto: object) => api.post<Workflow>('/workflows', dto),
  update: (id: string, dto: object) => api.patch<Workflow>(`/workflows/${id}`, dto),
  toggle: (id: string, isActive: boolean) => api.patch<Workflow>(`/workflows/${id}`, { isActive }),
  remove: (id: string) => api.delete<void>(`/workflows/${id}`),
};

// ── Labels ─────────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<ActionType, string> = {
  SEND_EMAIL: 'Trimite email',
  CREATE_TASK: 'Crează task',
  ADD_NOTE: 'Adaugă notă',
  WAIT_DAYS: 'Așteaptă N zile',
};

const TRIGGER_LABELS: Record<WorkflowTrigger, string> = {
  DEAL_CREATED: 'Deal creat',
  DEAL_STAGE_CHANGED: 'Deal mutat în etapă',
  CONTACT_CREATED: 'Contact creat',
  COMPANY_CREATED: 'Companie creată',
};

// ── Page ───────────────────────────────────────────────────────────────────────

export function WorkflowsPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);

  const { data, isLoading, isError, error } = useQuery({
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

  if (showForm || editingWorkflow) {
    return (
      <WorkflowForm
        existing={editingWorkflow}
        onDone={() => { setShowForm(false); setEditingWorkflow(null); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Automatizări (Workflows)</h1>
        <Button onClick={() => setShowForm(true)}>+ Workflow nou</Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={isError} error={error} label="Nu am putut încărca workflow-urile." />

      {!isLoading && workflows.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">
            Niciun workflow. Apasă <strong>+ Workflow nou</strong> pentru a crea primul.
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
                  <Button size="sm" variant="outline" onClick={() => setEditingWorkflow(wf)}>
                    Editează
                  </Button>
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
              <div className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">Pași ({wf.steps.length}):</span>
                {wf.steps.length === 0 && <span className="text-muted-foreground">(fără pași)</span>}
                {wf.steps.map((s, i) => (
                  <span key={s.id} className="inline-flex items-center gap-1">
                    {i > 0 && <span className="text-muted-foreground">→</span>}
                    <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                      {ACTION_LABELS[s.actionType] ?? s.actionType}
                    </span>
                  </span>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// ── Workflow form (create + edit) ──────────────────────────────────────────────

function WorkflowForm({ existing, onDone }: { existing: Workflow | null; onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const isEdit = !!existing;

  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [trigger, setTrigger] = useState<WorkflowTrigger>(existing?.trigger ?? 'DEAL_CREATED');
  const [steps, setSteps] = useState<DraftStep[]>(
    existing?.steps.map((s) => ({
      actionType: s.actionType,
      actionConfig: Object.fromEntries(
        Object.entries(s.actionConfig).map(([k, v]) => [k, String(v)]),
      ),
    })) ?? [],
  );
  const [error, setError] = useState('');

  const saveMut = useMutation({
    mutationFn: (dto: object) =>
      isEdit ? workflowsApi.update(existing!.id, dto) : workflowsApi.create(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workflows'] });
      onDone();
    },
    onError: (err: Error) => setError(err.message),
  });

  function addStep(): void {
    setSteps((prev) => [...prev, { actionType: 'CREATE_TASK', actionConfig: { title: '', dueDaysAfter: '1' } }]);
  }

  function removeStep(idx: number): void {
    setSteps((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateStep(idx: number, patch: Partial<DraftStep>): void {
    setSteps((prev) =>
      prev.map((s, i) => {
        if (i !== idx) return s;
        const next = { ...s, ...patch };
        // Reset config when action type changes
        if (patch.actionType && patch.actionType !== s.actionType) {
          next.actionConfig = defaultConfig(patch.actionType);
        }
        return next;
      }),
    );
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    if (!name.trim()) { setError('Numele este obligatoriu.'); return; }
    setError('');
    saveMut.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      trigger,
      triggerConfig: {},
      steps: steps.map((s, i) => ({
        order: i,
        actionType: s.actionType,
        actionConfig: parseConfig(s.actionType, s.actionConfig),
      })),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onDone}>← Înapoi</Button>
        <h1 className="text-2xl font-semibold">
          {isEdit ? `Editează: ${existing!.name}` : 'Workflow nou'}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic info */}
        <Card>
          <CardHeader><CardTitle className="text-base">Informații generale</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Nume *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Urmărire deal creat" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Descriere</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Opțional" />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Trigger</label>
              <select
                className="w-full rounded border border-input px-3 py-2 text-sm"
                value={trigger}
                onChange={(e) => setTrigger(e.target.value as WorkflowTrigger)}
              >
                {(Object.keys(TRIGGER_LABELS) as WorkflowTrigger[]).map((t) => (
                  <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
                ))}
              </select>
            </div>
          </CardContent>
        </Card>

        {/* Steps */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Pași ({steps.length})</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addStep}>+ Adaugă pas</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {steps.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Niciun pas. Apasă &quot;+ Adaugă pas&quot; pentru a începe.
              </p>
            )}
            {steps.map((step, idx) => (
              <StepEditor
                key={idx}
                idx={idx}
                step={step}
                onChange={(patch) => updateStep(idx, patch)}
                onRemove={() => removeStep(idx)}
              />
            ))}
          </CardContent>
        </Card>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-3">
          <Button type="submit" disabled={saveMut.isPending}>
            {saveMut.isPending ? 'Se salvează…' : isEdit ? 'Salvează modificările' : 'Crează workflow'}
          </Button>
          <Button type="button" variant="ghost" onClick={onDone}>Anulează</Button>
        </div>
      </form>
    </div>
  );
}

// ── Step editor ─────────────────────────────────────────────────────────────────

function StepEditor({
  idx,
  step,
  onChange,
  onRemove,
}: {
  idx: number;
  step: DraftStep;
  onChange: (patch: Partial<DraftStep>) => void;
  onRemove: () => void;
}): JSX.Element {
  const cfg = step.actionConfig;

  return (
    <div className="rounded-lg border bg-muted/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">Pas {idx + 1}</span>
        <Button type="button" variant="ghost" size="sm" className="text-destructive h-7 px-2" onClick={onRemove}>
          Șterge
        </Button>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-medium text-muted-foreground">Acțiune</label>
        <select
          className="w-full rounded border border-input px-2 py-1.5 text-sm"
          value={step.actionType}
          onChange={(e) => onChange({ actionType: e.target.value as ActionType })}
        >
          {(Object.keys(ACTION_LABELS) as ActionType[]).map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a]}</option>
          ))}
        </select>
      </div>

      {/* Per-action config fields */}
      {step.actionType === 'SEND_EMAIL' && (
        <>
          <ConfigField label="Subiect email" value={cfg['subject'] ?? ''} onChange={(v) => onChange({ actionConfig: { ...cfg, subject: v } })} />
          <ConfigField label="Corp email" value={cfg['body'] ?? ''} onChange={(v) => onChange({ actionConfig: { ...cfg, body: v } })} multiline />
        </>
      )}
      {step.actionType === 'CREATE_TASK' && (
        <>
          <ConfigField label="Titlu task" value={cfg['title'] ?? ''} onChange={(v) => onChange({ actionConfig: { ...cfg, title: v } })} />
          <ConfigField label="Scadent după (zile)" value={cfg['dueDaysAfter'] ?? '1'} type="number" onChange={(v) => onChange({ actionConfig: { ...cfg, dueDaysAfter: v } })} />
        </>
      )}
      {step.actionType === 'ADD_NOTE' && (
        <ConfigField label="Conținut notă" value={cfg['content'] ?? ''} onChange={(v) => onChange({ actionConfig: { ...cfg, content: v } })} multiline />
      )}
      {step.actionType === 'WAIT_DAYS' && (
        <ConfigField label="Zile de așteptat" value={cfg['days'] ?? '1'} type="number" onChange={(v) => onChange({ actionConfig: { ...cfg, days: v } })} />
      )}
    </div>
  );
}

function ConfigField({
  label,
  value,
  onChange,
  type = 'text',
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  multiline?: boolean;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {multiline ? (
        <textarea
          className="w-full rounded border border-input px-2 py-1.5 text-sm resize-none"
          rows={3}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type={type}
          className="w-full rounded border border-input px-2 py-1.5 text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────────

function defaultConfig(type: ActionType): Record<string, string> {
  switch (type) {
    case 'SEND_EMAIL': return { subject: '', body: '' };
    case 'CREATE_TASK': return { title: '', dueDaysAfter: '1' };
    case 'ADD_NOTE': return { content: '' };
    case 'WAIT_DAYS': return { days: '1' };
  }
}

function parseConfig(type: ActionType, raw: Record<string, string>): Record<string, unknown> {
  switch (type) {
    case 'SEND_EMAIL': return { subject: raw['subject'] ?? '', body: raw['body'] ?? '' };
    case 'CREATE_TASK': return { title: raw['title'] ?? '', dueDaysAfter: Number(raw['dueDaysAfter'] ?? 1) };
    case 'ADD_NOTE': return { content: raw['content'] ?? '' };
    case 'WAIT_DAYS': return { days: Number(raw['days'] ?? 1) };
  }
}
