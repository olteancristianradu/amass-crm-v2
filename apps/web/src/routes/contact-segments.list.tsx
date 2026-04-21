import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import {
  contactSegmentsApi,
  type ContactSegment,
  type FilterGroup,
  type FilterRule,
  type FilterOperator,
} from '@/features/contact-segments/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { QueryError } from '@/components/ui/QueryError';

export const contactSegmentsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/contact-segments',
  component: ContactSegmentsPage,
});

const FIELDS: { value: string; label: string }[] = [
  { value: 'firstName', label: 'Prenume' },
  { value: 'lastName', label: 'Nume' },
  { value: 'email', label: 'Email' },
  { value: 'jobTitle', label: 'Funcție' },
  { value: 'phone', label: 'Telefon' },
  { value: 'isDecider', label: 'Factor decizional' },
  { value: 'companyId', label: 'ID Companie' },
];

const OPERATORS: { value: FilterOperator; label: string; noValue?: boolean }[] = [
  { value: 'eq', label: 'este egal cu' },
  { value: 'neq', label: 'nu este egal cu' },
  { value: 'contains', label: 'conține' },
  { value: 'not_contains', label: 'nu conține' },
  { value: 'starts_with', label: 'începe cu' },
  { value: 'is_empty', label: 'este gol', noValue: true },
  { value: 'is_not_empty', label: 'nu este gol', noValue: true },
  { value: 'is_true', label: 'este adevărat', noValue: true },
  { value: 'is_false', label: 'este fals', noValue: true },
];

interface RuleDraft {
  field: string;
  operator: FilterOperator;
  value: string;
}

function emptyRule(): RuleDraft {
  return { field: 'firstName', operator: 'contains', value: '' };
}

function ContactSegmentsPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [previewSegId, setPreviewSegId] = useState<string | null>(null);

  const { data: segments = [], isLoading, isError, error } = useQuery({
    queryKey: ['contact-segments'],
    queryFn: () => contactSegmentsApi.list(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => contactSegmentsApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['contact-segments'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Segmente contacte</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Segment nou'}
        </Button>
      </div>

      {showForm && <NewSegmentForm onDone={() => setShowForm(false)} />}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={isError} error={error} label="Nu am putut încărca segmentele." />

      <div className="space-y-3">
        {(segments as ContactSegment[]).map((seg) => (
          <Card key={seg.id}>
            <CardContent className="py-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium">{seg.name}</h3>
                  {seg.description && (
                    <p className="text-sm text-muted-foreground">{seg.description}</p>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Filtru: {seg.filterJson.op} · {seg.filterJson.rules.length} reguli
                  </p>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setPreviewSegId(seg.id === previewSegId ? null : seg.id)}
                    className="rounded bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20"
                  >
                    {previewSegId === seg.id ? 'Ascunde' : 'Preview'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Ștergi segmentul "${seg.name}"?`)) deleteMut.mutate(seg.id);
                    }}
                    className="rounded bg-destructive/10 px-3 py-1 text-xs text-destructive hover:bg-destructive/20"
                  >
                    Șterge
                  </button>
                </div>
              </div>
              {previewSegId === seg.id && <SegmentPreview segmentId={seg.id} />}
            </CardContent>
          </Card>
        ))}
        {!isLoading && (segments as ContactSegment[]).length === 0 && (
          <p className="text-sm text-muted-foreground">
            Niciun segment salvat. Creează unul pentru a segmenta contactele cu filtre AND/OR.
          </p>
        )}
      </div>
    </div>
  );
}

function SegmentPreview({ segmentId }: { segmentId: string }): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['segment-preview', segmentId],
    queryFn: () => contactSegmentsApi.preview(segmentId, 20),
  });

  if (isLoading) return <p className="text-xs mt-2 text-muted-foreground">Se încarcă preview…</p>;
  const contacts = data ?? [];
  if (contacts.length === 0) return <p className="text-xs mt-2 text-muted-foreground">Niciun contact corespunde filtrelor.</p>;

  return (
    <div className="mt-3 rounded border overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th scope="col" className="px-3 py-1 text-left font-medium">Nume</th>
            <th scope="col" className="px-3 py-1 text-left font-medium">Email</th>
            <th scope="col" className="px-3 py-1 text-left font-medium">Funcție</th>
            <th scope="col" className="px-3 py-1 text-left font-medium">Decident</th>
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id} className="border-t hover:bg-muted/20">
              <td className="px-3 py-1">{c.firstName} {c.lastName}</td>
              <td className="px-3 py-1">{c.email ?? '—'}</td>
              <td className="px-3 py-1">{c.jobTitle ?? '—'}</td>
              <td className="px-3 py-1">{c.isDecider ? '✓' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {contacts.length === 20 && (
        <p className="px-3 py-1 text-xs text-muted-foreground border-t">Se afișează maxim 20 rezultate.</p>
      )}
    </div>
  );
}

function NewSegmentForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [op, setOp] = useState<'AND' | 'OR'>('AND');
  const [rules, setRules] = useState<RuleDraft[]>([emptyRule()]);
  const [err, setErr] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () => {
      const filterJson: FilterGroup = {
        op,
        rules: rules.map((r) => {
          const opDef = OPERATORS.find((o) => o.value === r.operator);
          const rule: FilterRule = { field: r.field, operator: r.operator };
          if (!opDef?.noValue) rule.value = r.value;
          return rule;
        }),
      };
      return contactSegmentsApi.create({ name, description: description || undefined, filterJson });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contact-segments'] });
      onDone();
    },
    onError: (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Eroare'),
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) { setErr('Numele este obligatoriu'); return; }
    createMut.mutate();
  }

  function updateRule(i: number, field: keyof RuleDraft, val: string): void {
    setRules((prev) => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));
  }

  const currentOpDef = (r: RuleDraft) => OPERATORS.find((o) => o.value === r.operator);

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Segment nou</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="seg-name">Nume segment *</Label>
              <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="seg-desc">Descriere</Label>
              <Input id="seg-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-medium">Contactele care îndeplinesc</h3>
              <div className="flex rounded border overflow-hidden">
                <button
                  type="button"
                  onClick={() => setOp('AND')}
                  className={`px-3 py-1 text-xs font-medium ${op === 'AND' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
                >
                  TOATE (AND)
                </button>
                <button
                  type="button"
                  onClick={() => setOp('OR')}
                  className={`px-3 py-1 text-xs font-medium ${op === 'OR' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70'}`}
                >
                  ORICARE (OR)
                </button>
              </div>
              <span className="text-sm text-muted-foreground">regulile de mai jos</span>
            </div>

            {rules.map((rule, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={rule.field}
                  onChange={(e) => updateRule(i, 'field', e.target.value)}
                  className="rounded border border-input px-2 py-1 text-sm"
                >
                  {FIELDS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
                <select
                  value={rule.operator}
                  onChange={(e) => updateRule(i, 'operator', e.target.value as FilterOperator)}
                  className="rounded border border-input px-2 py-1 text-sm"
                >
                  {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                {!currentOpDef(rule)?.noValue && (
                  <Input
                    value={rule.value}
                    onChange={(e) => updateRule(i, 'value', e.target.value)}
                    placeholder="valoare"
                    className="max-w-[160px]"
                  />
                )}
                {rules.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setRules((p) => p.filter((_, idx) => idx !== i))}
                    className="text-destructive text-lg leading-none flex-shrink-0"
                  >×</button>
                )}
              </div>
            ))}
            <Button
              type="button" variant="outline" size="sm"
              onClick={() => setRules((p) => [...p, emptyRule()])}
            >
              + Regulă
            </Button>
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Se salvează…' : 'Salvează segmentul'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
