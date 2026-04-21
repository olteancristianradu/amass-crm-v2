import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { leadsApi, type Lead, type LeadStatus, type LeadSource } from '@/features/leads/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<LeadStatus, string> = {
  NEW: 'Nou',
  CONTACTED: 'Contactat',
  QUALIFIED: 'Calificat',
  DISQUALIFIED: 'Descalificat',
  CONVERTED: 'Convertit',
};

const STATUS_CLASSES: Record<LeadStatus, string> = {
  NEW: 'bg-blue-100 text-blue-800',
  CONTACTED: 'bg-yellow-100 text-yellow-800',
  QUALIFIED: 'bg-green-100 text-green-800',
  DISQUALIFIED: 'bg-red-100 text-red-800',
  CONVERTED: 'bg-purple-100 text-purple-800',
};

const SOURCE_LABELS: Record<LeadSource, string> = {
  REFERRAL: 'Recomandare',
  WEB: 'Website',
  COLD_CALL: 'Apel rece',
  EVENT: 'Eveniment',
  PARTNER: 'Partener',
  SOCIAL: 'Social media',
  OTHER: 'Altele',
};

function StatusBadge({ status }: { status: LeadStatus }): JSX.Element {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLASSES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ title, value, highlight }: { title: string; value: number | string; highlight?: boolean }): JSX.Element {
  return (
    <Card className={highlight ? 'border-red-300' : undefined}>
      <CardHeader className="pb-1">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${highlight ? 'text-red-600' : ''}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

// ── Convert modal ─────────────────────────────────────────────────────────────

interface ConvertModalProps {
  lead: Lead;
  onClose: () => void;
}

function ConvertModal({ lead, onClose }: ConvertModalProps): JSX.Element {
  const qc = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);
  const [createCompany, setCreateCompany] = useState(true);
  const [createContact, setCreateContact] = useState(true);
  const [createDeal, setCreateDeal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      leadsApi.convert(lead.id, { createCompany, createContact, createDeal }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['leads'] });
      onClose();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Eroare la conversie.');
    },
  });

  function handleOverlay(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === overlayRef.current) onClose();
  }

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlay}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-2 text-lg font-semibold">
          Convertește lead: {lead.firstName} {lead.lastName}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Selectează ce să fie creat la conversie.
        </p>

        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createCompany}
              onChange={(e) => setCreateCompany(e.target.checked)}
              className="rounded"
            />
            Creează companie ({lead.company ?? 'fără nume'})
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createContact}
              onChange={(e) => setCreateContact(e.target.checked)}
              className="rounded"
            />
            Creează contact ({lead.firstName} {lead.lastName})
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={createDeal}
              onChange={(e) => setCreateDeal(e.target.checked)}
              className="rounded"
            />
            Creează deal în pipeline implicit
          </label>
        </div>

        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={mutation.isPending}>
            Anulează
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Se procesează…' : 'Convertește'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── New lead form ─────────────────────────────────────────────────────────────

function NewLeadForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [company, setCompany] = useState('');
  const [source, setSource] = useState<LeadSource | ''>('');
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      leadsApi.create({
        firstName,
        lastName,
        email: email || undefined,
        company: company || undefined,
        source: source || undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['leads'] });
      onDone();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Eroare la creare.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Lead nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            createMut.mutate();
          }}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="lead-first">Prenume *</Label>
            <Input
              id="lead-first"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-last">Nume *</Label>
            <Input
              id="lead-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-email">Email</Label>
            <Input
              id="lead-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-company">Companie</Label>
            <Input
              id="lead-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
            />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="lead-source">Sursă</Label>
            <select
              id="lead-source"
              value={source}
              onChange={(e) => setSource(e.target.value as LeadSource | '')}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="">— selectează —</option>
              {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className="md:col-span-2">
            {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={createMut.isPending || !firstName.trim() || !lastName.trim()}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function LeadsListPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<LeadStatus | ''>('');
  const [filterSource, setFilterSource] = useState<string>('');
  const [convertingLead, setConvertingLead] = useState<Lead | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['leads', { filterStatus, filterSource }],
    queryFn: () =>
      leadsApi.list({
        status: filterStatus || undefined,
        source: filterSource ? (filterSource as LeadSource) : undefined,
        limit: 50,
      }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => leadsApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['leads'] }),
  });

  const rows = data?.data ?? [];

  // Compute simple KPIs client-side from current page results (full-server KPI
  // endpoint can replace this later without changing the UI contract).
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = new Date().toISOString().slice(0, 7);

  const totalLeads = rows.length;
  const newToday = rows.filter(
    (l) => l.status === 'NEW' && l.createdAt.slice(0, 10) === today,
  ).length;
  const qualified = rows.filter((l) => l.status === 'QUALIFIED').length;
  const convertedThisMonth = rows.filter(
    (l) => l.status === 'CONVERTED' && l.updatedAt.startsWith(thisMonth),
  ).length;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Leads</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Lead nou'}
        </Button>
      </div>

      {/* KPI cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total leads" value={totalLeads} />
        <KpiCard title="Noi azi" value={newToday} />
        <KpiCard title="Calificați" value={qualified} />
        <KpiCard title="Convertiți (luna)" value={convertedThisMonth} />
      </div>

      {/* New lead form */}
      {showForm && <NewLeadForm onDone={() => setShowForm(false)} />}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as LeadStatus | '')}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate statusurile</option>
          {(Object.entries(STATUS_LABELS) as [LeadStatus, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate sursele</option>
          {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {isLoading && <Card><TableSkeleton rows={6} cols={8} /></Card>}
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
                  <th scope="col" className="px-4 py-2 font-medium">Nume complet</th>
                  <th scope="col" className="px-4 py-2 font-medium">Email</th>
                  <th scope="col" className="px-4 py-2 font-medium">Companie</th>
                  <th scope="col" className="px-4 py-2 font-medium">Sursă</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Scor</th>
                  <th scope="col" className="px-4 py-2 font-medium">Creat</th>
                  <th scope="col" className="px-4 py-2 font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun lead. Adaugă primul lead folosind butonul de mai sus.
                    </td>
                  </tr>
                )}
                {rows.map((lead) => (
                  <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">
                      {lead.firstName} {lead.lastName}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {lead.email ?? '—'}
                    </td>
                    <td className="px-4 py-2">{lead.company ?? '—'}</td>
                    <td className="px-4 py-2">
                      {lead.source ? SOURCE_LABELS[lead.source] : '—'}
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge status={lead.status} />
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-xs">
                      {lead.score != null ? lead.score : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(lead.createdAt).toLocaleDateString('ro-RO')}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        {lead.status !== 'CONVERTED' && lead.status !== 'DISQUALIFIED' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setConvertingLead(lead)}
                          >
                            Convertește
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteMut.isPending}
                          onClick={() => {
                            if (confirm('Ștergi acest lead?')) {
                              deleteMut.mutate(lead.id);
                            }
                          }}
                        >
                          ×
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Cursor pagination (next page) */}
      {data?.nextCursor && (
        <div className="flex justify-center">
          <p className="text-xs text-muted-foreground">
            Există mai multe rezultate — restrânge filtrele sau implementează paginarea.
          </p>
        </div>
      )}

      {/* Convert modal */}
      {convertingLead && (
        <ConvertModal lead={convertingLead} onClose={() => setConvertingLead(null)} />
      )}
    </div>
  );
}
