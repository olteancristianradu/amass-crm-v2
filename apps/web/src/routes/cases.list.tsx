import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { casesApi, type CaseStatus, type CasePriority } from '@/features/cases/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const casesListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/cases',
  component: CasesListPage,
});

const STATUS_LABELS: Record<CaseStatus, string> = {
  NEW: 'Nou',
  OPEN: 'Deschis',
  PENDING: 'În așteptare',
  RESOLVED: 'Rezolvat',
  CLOSED: 'Închis',
};

const STATUS_CLASSES: Record<CaseStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  OPEN: 'bg-yellow-100 text-yellow-800',
  PENDING: 'bg-orange-100 text-orange-800',
  RESOLVED: 'bg-green-100 text-green-800',
  CLOSED: 'bg-gray-200 text-gray-700',
};

const PRIORITY_LABELS: Record<CasePriority, string> = {
  LOW: 'Scăzută',
  NORMAL: 'Normală',
  HIGH: 'Înaltă',
  URGENT: 'Urgentă',
};

const PRIORITY_CLASSES: Record<CasePriority, string> = {
  LOW: 'bg-gray-100 text-gray-600',
  NORMAL: 'bg-slate-100 text-slate-700',
  HIGH: 'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-800 font-semibold',
};

function isSlaBreached(slaDeadline: string | null | undefined, status: CaseStatus): boolean {
  if (!slaDeadline) return false;
  if (status === 'RESOLVED' || status === 'CLOSED') return false;
  return new Date(slaDeadline).getTime() < Date.now();
}

function NewCaseForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<CasePriority>('NORMAL');
  const [slaDeadline, setSlaDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      casesApi.create({
        subject,
        description: description || undefined,
        priority,
        slaDeadline: slaDeadline || undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['cases'] });
      onDone();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Eroare la creare.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Tichet nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => { e.preventDefault(); setError(null); mut.mutate(); }}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="case-subject">Subiect *</Label>
            <Input id="case-subject" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="case-description">Descriere</Label>
            <textarea
              id="case-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="case-priority">Prioritate</Label>
            <select
              id="case-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as CasePriority)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {(Object.entries(PRIORITY_LABELS) as [CasePriority, string][]).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="case-sla">SLA deadline</Label>
            <Input
              id="case-sla"
              type="datetime-local"
              value={slaDeadline}
              onChange={(e) => setSlaDeadline(e.target.value)}
            />
          </div>
          <div className="md:col-span-2">
            {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={mut.isPending || !subject.trim()}>
              {mut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CasesListPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<CaseStatus | ''>('');
  const [filterPriority, setFilterPriority] = useState<CasePriority | ''>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['cases', { filterStatus, filterPriority }],
    queryFn: () =>
      casesApi.list({
        status: filterStatus || undefined,
        priority: filterPriority || undefined,
        limit: 50,
      }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CaseStatus }) =>
      casesApi.update(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cases'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => casesApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cases'] }),
  });

  const rows = data?.data ?? [];
  const open = rows.filter((c) => c.status !== 'RESOLVED' && c.status !== 'CLOSED');
  const breached = open.filter((c) => isSlaBreached(c.slaDeadline, c.status)).length;
  const urgent = open.filter((c) => c.priority === 'URGENT').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tichete suport</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Tichet nou'}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Tichete deschise</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{open.length}</div></CardContent>
        </Card>
        <Card className={breached > 0 ? 'border-red-300' : undefined}>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">SLA depășit</CardTitle>
          </CardHeader>
          <CardContent><div className={`text-2xl font-bold ${breached > 0 ? 'text-red-600' : ''}`}>{breached}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1">
            <CardTitle className="text-sm font-medium text-muted-foreground">Urgente</CardTitle>
          </CardHeader>
          <CardContent><div className="text-2xl font-bold">{urgent}</div></CardContent>
        </Card>
      </div>

      {showForm && <NewCaseForm onDone={() => setShowForm(false)} />}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as CaseStatus | '')}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate statusurile</option>
          {(Object.entries(STATUS_LABELS) as [CaseStatus, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as CasePriority | '')}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate prioritățile</option>
          {(Object.entries(PRIORITY_LABELS) as [CasePriority, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {isLoading && <Card><TableSkeleton rows={6} cols={6} /></Card>}
      {isError && (
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {data && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">#</th>
                  <th scope="col" className="px-4 py-2 font-medium">Subiect</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Prioritate</th>
                  <th scope="col" className="px-4 py-2 font-medium">SLA</th>
                  <th scope="col" className="px-4 py-2 font-medium">Creat</th>
                  <th scope="col" className="px-4 py-2 font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun tichet.
                    </td>
                  </tr>
                )}
                {rows.map((c) => {
                  const breached = isSlaBreached(c.slaDeadline, c.status);
                  return (
                    <tr key={c.id} className={`border-b last:border-0 hover:bg-muted/30 ${breached ? 'bg-red-50' : ''}`}>
                      <td className="px-4 py-2 font-mono text-xs">#{c.number}</td>
                      <td className="px-4 py-2 font-medium">{c.subject}</td>
                      <td className="px-4 py-2">
                        <select
                          value={c.status}
                          onChange={(e) => updateMut.mutate({ id: c.id, status: e.target.value as CaseStatus })}
                          className={`text-xs px-2 py-0.5 rounded ${STATUS_CLASSES[c.status]} border-0`}
                        >
                          {(Object.entries(STATUS_LABELS) as [CaseStatus, string][]).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2">
                        <span className={`rounded px-2 py-0.5 text-xs ${PRIORITY_CLASSES[c.priority]}`}>
                          {PRIORITY_LABELS[c.priority]}
                        </span>
                      </td>
                      <td className={`px-4 py-2 text-xs ${breached ? 'font-semibold text-red-600' : ''}`}>
                        {c.slaDeadline ? new Date(c.slaDeadline).toLocaleString('ro-RO') : '—'}
                        {breached && ' ⚠'}
                      </td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">
                        {new Date(c.createdAt).toLocaleDateString('ro-RO')}
                      </td>
                      <td className="px-4 py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (confirm('Ștergi tichetul?')) deleteMut.mutate(c.id);
                          }}
                        >
                          ×
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
