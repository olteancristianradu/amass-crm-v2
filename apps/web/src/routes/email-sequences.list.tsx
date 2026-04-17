import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { emailSequencesApi, type EmailSequence, type SequenceStepInput } from '@/features/email-sequences/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';

export const emailSequencesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/email-sequences',
  component: EmailSequencesPage,
});

function EmailSequencesPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);

  const { data: sequences = [], isLoading } = useQuery({
    queryKey: ['email-sequences'],
    queryFn: () => emailSequencesApi.list(),
  });

  const activateMut = useMutation({
    mutationFn: (id: string) => emailSequencesApi.activate(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-sequences'] }),
  });

  const pauseMut = useMutation({
    mutationFn: (id: string) => emailSequencesApi.pause(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-sequences'] }),
  });

  const archiveMut = useMutation({
    mutationFn: (id: string) => emailSequencesApi.archive(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-sequences'] }),
  });

  const STATUS_BADGE: Record<string, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    ACTIVE: 'bg-green-100 text-green-800',
    PAUSED: 'bg-yellow-100 text-yellow-800',
    ARCHIVED: 'bg-gray-200 text-gray-500',
  };

  const STATUS_LABEL: Record<string, string> = {
    DRAFT: 'Schiță', ACTIVE: 'Activă', PAUSED: 'Pausată', ARCHIVED: 'Arhivată',
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Secvențe email</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Secvență nouă'}
        </Button>
      </div>

      {showForm && <NewSequenceForm onDone={() => setShowForm(false)} />}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}

      <div className="space-y-3">
        {(sequences as EmailSequence[]).map((seq) => (
          <Card key={seq.id}>
            <CardContent className="py-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{seq.name}</h3>
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[seq.status] ?? ''}`}>
                      {STATUS_LABEL[seq.status] ?? seq.status}
                    </span>
                  </div>
                  {seq.description && <p className="text-sm text-muted-foreground mt-1">{seq.description}</p>}
                  <p className="text-xs text-muted-foreground mt-1">
                    {seq.steps.length} pas{seq.steps.length !== 1 ? 'i' : ''} ·{' '}
                    {seq._count?.enrollments ?? 0} înrolat{(seq._count?.enrollments ?? 0) !== 1 ? 'e' : ''}
                  </p>
                  <div className="mt-2 space-y-1">
                    {seq.steps.map((step, i) => (
                      <div key={step.id} className="flex gap-2 text-xs text-muted-foreground">
                        <span className="w-5 font-mono">{i + 1}.</span>
                        <span className="font-medium">{step.subject}</span>
                        {step.delayDays > 0 && <span>(+{step.delayDays} zile)</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {seq.status === 'DRAFT' && (
                    <button
                      type="button"
                      onClick={() => activateMut.mutate(seq.id)}
                      className="rounded bg-green-100 px-3 py-1 text-xs font-medium text-green-800 hover:bg-green-200"
                    >
                      Activează
                    </button>
                  )}
                  {seq.status === 'ACTIVE' && (
                    <>
                      <button
                        type="button"
                        onClick={() => setEnrollingId(seq.id)}
                        className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
                      >
                        Înrolează contact
                      </button>
                      <button
                        type="button"
                        onClick={() => pauseMut.mutate(seq.id)}
                        className="rounded bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800 hover:bg-yellow-200"
                      >
                        Pausează
                      </button>
                    </>
                  )}
                  {seq.status === 'PAUSED' && (
                    <button
                      type="button"
                      onClick={() => activateMut.mutate(seq.id)}
                      className="rounded bg-green-100 px-3 py-1 text-xs font-medium text-green-800 hover:bg-green-200"
                    >
                      Reactivează
                    </button>
                  )}
                  {seq.status !== 'ARCHIVED' && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Arhivezi "${seq.name}"?`)) archiveMut.mutate(seq.id);
                      }}
                      className="rounded bg-gray-100 px-3 py-1 text-xs text-gray-600 hover:bg-gray-200"
                    >
                      Arhivează
                    </button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && (sequences as EmailSequence[]).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nicio secvență. Creează una pentru a trimite drip campanii automate.
          </p>
        )}
      </div>

      {enrollingId && (
        <EnrollDialog
          sequenceId={enrollingId}
          onClose={() => setEnrollingId(null)}
        />
      )}
    </div>
  );
}

// ── New sequence form ─────────────────────────────────────────────────────────

interface StepDraft {
  order: number;
  delayDays: string;
  subject: string;
  bodyHtml: string;
}

function emptyStep(order: number): StepDraft {
  return { order, delayDays: '0', subject: '', bodyHtml: '' };
}

function NewSequenceForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<StepDraft[]>([emptyStep(0)]);
  const [err, setErr] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => {
      const payload: SequenceStepInput[] = steps.map((s) => ({
        order: s.order,
        delayDays: parseInt(s.delayDays, 10),
        subject: s.subject,
        bodyHtml: s.bodyHtml,
      }));
      return emailSequencesApi.create({ name, description: description || undefined, steps: payload });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['email-sequences'] });
      onDone();
    },
    onError: (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Eroare'),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) { setErr('Numele este obligatoriu'); return; }
    if (steps.some((s) => !s.subject.trim())) { setErr('Fiecare pas trebuie să aibă subiect'); return; }
    createMut.mutate();
  }

  function updateStep(i: number, field: keyof StepDraft, val: string): void {
    setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Secvență nouă</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="seq-name">Nume *</Label>
              <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="seq-desc">Descriere</Label>
              <Input id="seq-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Pași secvență</h3>
              <Button
                type="button" variant="outline" size="sm"
                onClick={() => setSteps((p) => [...p, emptyStep(p.length)])}
              >
                + Pas
              </Button>
            </div>
            {steps.map((step, i) => (
              <div key={i} className="rounded border p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">Pasul {i + 1}</span>
                  <div className="flex items-center gap-2">
                    <Label className="text-xs">Delay (zile):</Label>
                    <input
                      type="number" min="0"
                      value={step.delayDays}
                      onChange={(e) => updateStep(i, 'delayDays', e.target.value)}
                      className="w-16 rounded border border-input px-2 py-1 text-sm"
                    />
                    {steps.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setSteps((p) => p.filter((_, idx) => idx !== i).map((s, newIdx) => ({ ...s, order: newIdx })))}
                        className="text-destructive text-lg leading-none"
                      >×</button>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Subiect email *</Label>
                  <Input
                    value={step.subject}
                    onChange={(e) => updateStep(i, 'subject', e.target.value)}
                    placeholder="ex: Urmărire ofertă"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Conținut (HTML)</Label>
                  <textarea
                    value={step.bodyHtml}
                    onChange={(e) => updateStep(i, 'bodyHtml', e.target.value)}
                    rows={4}
                    className="w-full rounded border border-input px-3 py-2 text-sm font-mono"
                    placeholder="<p>Bună {{firstName}},</p>"
                  />
                </div>
              </div>
            ))}
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Se salvează…' : 'Salvează secvența'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Enroll dialog ─────────────────────────────────────────────────────────────

function EnrollDialog({ sequenceId, onClose }: { sequenceId: string; onClose: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => emailSequencesApi.enroll(sequenceId, { sequenceId, toEmail: email }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['email-sequences'] });
      onClose();
    },
    onError: (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Eroare'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Înrolează contact în secvență</h2>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="enroll-email">Adresă email *</Label>
            <Input
              id="enroll-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@firma.ro"
            />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Anulează</Button>
            <Button onClick={() => mut.mutate()} disabled={mut.isPending || !email}>
              {mut.isPending ? 'Se procesează…' : 'Înrolează'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
