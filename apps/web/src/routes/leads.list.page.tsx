import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { Plus, Target, X } from 'lucide-react';
import { leadsApi, type Lead, type LeadStatus, type LeadSource } from '@/features/leads/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  ListSurface,
  PageHeader,
  StatusBadge,
  type StatusBadgeTone,
  Toolbar,
} from '@/components/ui/page-header';
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

const STATUS_TONES: Record<LeadStatus, StatusBadgeTone> = {
  NEW: 'blue',
  CONTACTED: 'amber',
  QUALIFIED: 'green',
  DISQUALIFIED: 'pink',
  CONVERTED: 'green',
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

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({
  title,
  value,
  highlight,
}: {
  title: string;
  value: number | string;
  highlight?: boolean;
}): JSX.Element {
  return (
    <GlassCard className="p-5">
      <p className="text-xs uppercase tracking-wider text-muted-foreground">{title}</p>
      <p
        className={`mt-2 text-3xl font-semibold tabular-nums ${
          highlight ? 'text-destructive' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </GlassCard>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <GlassCard elevation="elevated" className="w-full max-w-md p-6">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Convertește lead
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {lead.firstName} {lead.lastName} — selectează ce să fie creat la conversie.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Închide"
          >
            <X size={16} />
          </button>
        </header>

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

        {error && (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Anulează
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? 'Se procesează…' : 'Convertește'}
          </Button>
        </div>
      </GlassCard>
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
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Lead nou</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          createMut.mutate();
        }}
        className="grid gap-4 md:grid-cols-2"
      >
        <div className="space-y-1.5">
          <Label htmlFor="lead-first">Prenume *</Label>
          <Input
            id="lead-first"
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-last">Nume *</Label>
          <Input
            id="lead-last"
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-email">Email</Label>
          <Input
            id="lead-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lead-company">Companie</Label>
          <Input
            id="lead-company"
            value={company}
            onChange={(e) => setCompany(e.target.value)}
          />
        </div>
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="lead-source">Sursă</Label>
          <select
            id="lead-source"
            value={source}
            onChange={(e) => setSource(e.target.value as LeadSource | '')}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">— selectează —</option>
            {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(([val, label]) => (
              <option key={val} value={val}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="md:col-span-2">
          {error && (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>
              Anulează
            </Button>
            <Button
              type="submit"
              disabled={createMut.isPending || !firstName.trim() || !lastName.trim()}
            >
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
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

  // Compute simple KPIs client-side from current page results.
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
    <div>
      <PageHeader
        title="Leads"
        subtitle="Lead-urile încă necalificate care încă nu au devenit contacte."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Lead nou'}
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard title="Total leads" value={totalLeads} />
        <KpiCard title="Noi azi" value={newToday} />
        <KpiCard title="Calificați" value={qualified} />
        <KpiCard title="Convertiți (luna)" value={convertedThisMonth} />
      </div>

      {showForm && <NewLeadForm onDone={() => setShowForm(false)} />}

      <Toolbar>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as LeadStatus | '')}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate statusurile</option>
          {(Object.entries(STATUS_LABELS) as [LeadStatus, string][]).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>

        <select
          value={filterSource}
          onChange={(e) => setFilterSource(e.target.value)}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate sursele</option>
          {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(([val, label]) => (
            <option key={val} value={val}>
              {label}
            </option>
          ))}
        </select>
      </Toolbar>

      {isLoading && (
        <ListSurface>
          <TableSkeleton rows={6} cols={8} />
        </ListSurface>
      )}
      {isError && (
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {data && (
        <ListSurface>
          {rows.length === 0 ? (
            <EmptyState
              icon={Target}
              title={filterStatus || filterSource ? 'Niciun lead pentru filtrul curent' : 'Niciun lead încă'}
              description={
                filterStatus || filterSource
                  ? 'Schimbă sau elimină filtrele pentru a vedea alte rezultate.'
                  : 'Adaugă primul lead, sau importă din meniul Operațional.'
              }
              action={
                !filterStatus && !filterSource && (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Lead nou
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">Nume complet</th>
                    <th scope="col" className="px-4 py-3 font-medium">Email</th>
                    <th scope="col" className="px-4 py-3 font-medium">Companie</th>
                    <th scope="col" className="px-4 py-3 font-medium">Sursă</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Scor</th>
                    <th scope="col" className="px-4 py-3 font-medium">Creat</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((lead) => (
                    <tr
                      key={lead.id}
                      className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3 font-medium">
                        {lead.firstName} {lead.lastName}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{lead.email ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">{lead.company ?? '—'}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {lead.source ? SOURCE_LABELS[lead.source] : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={STATUS_TONES[lead.status]}>
                          {STATUS_LABELS[lead.status]}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                        {lead.score != null ? lead.score : '—'}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                        {new Date(lead.createdAt).toLocaleDateString('ro-RO')}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
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
                            aria-label="Șterge lead"
                          >
                            <X size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ListSurface>
      )}

      {data?.nextCursor && (
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Există mai multe rezultate — restrânge filtrele sau implementează paginarea.
        </p>
      )}

      {convertingLead && (
        <ConvertModal lead={convertingLead} onClose={() => setConvertingLead(null)} />
      )}
    </div>
  );
}
