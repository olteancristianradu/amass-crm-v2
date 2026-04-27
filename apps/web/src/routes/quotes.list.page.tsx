import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Download, FileText, Plus, Trash2, X } from 'lucide-react';
import { quotesApi, type Quote, type QuoteStatus, type QuoteCurrency } from '@/features/quotes/api';
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
import { ApiError } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { TableSkeleton } from '@/components/ui/Skeleton';

export function QuotesListPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [statusFilter, setStatusFilter] = useState<QuoteStatus | ''>('');
  const [convertingQuote, setConvertingQuote] = useState<Quote | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['quotes', { status: statusFilter }],
    queryFn: () => quotesApi.list({ status: statusFilter || undefined, limit: 50 }),
  });

  const statusMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: QuoteStatus }) =>
      quotesApi.changeStatus(id, status),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['quotes'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => quotesApi.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['quotes'] }),
  });

  const rows = data?.data ?? [];

  function handleDelete(q: Quote): void {
    if (!confirm(`Ștergi oferta ${q.number}?`)) return;
    deleteMut.mutate(q.id);
  }

  function handleExport(): void {
    const exportRows = rows.map((q) => ({
      Număr: q.number,
      Titlu: q.title,
      Status: q.status,
      Total: q.total,
      Monedă: q.currency,
      'Data emiterii': new Date(q.issueDate).toLocaleDateString('ro-RO'),
      'Valabilă până': new Date(q.validUntil).toLocaleDateString('ro-RO'),
    }));
    downloadCsv(exportRows, `oferte-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <div>
      <PageHeader
        title="Oferte comerciale"
        subtitle="Oferte trimise clienților — DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download size={14} className="mr-1.5" />
              Export
            </Button>
            <Button size="sm" onClick={() => setShowForm((v) => !v)}>
              <Plus size={14} className="mr-1.5" />
              {showForm ? 'Anulează' : 'Ofertă nouă'}
            </Button>
          </>
        }
      />

      <Toolbar>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | '')}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">Toate statusurile</option>
          <option value="DRAFT">Schiță</option>
          <option value="SENT">Trimisă</option>
          <option value="ACCEPTED">Acceptată</option>
          <option value="REJECTED">Refuzată</option>
          <option value="EXPIRED">Expirată</option>
        </select>
      </Toolbar>

      {showForm && <NewQuoteForm onDone={() => setShowForm(false)} />}

      {isLoading && (
        <ListSurface>
          <TableSkeleton rows={5} cols={6} />
        </ListSurface>
      )}
      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Eroare la încărcarea ofertelor'}
        </p>
      )}

      {data && (
        <ListSurface>
          {rows.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={statusFilter ? 'Nicio ofertă pentru filtrul curent' : 'Nicio ofertă încă'}
              description={
                statusFilter
                  ? 'Schimbă filtrul de status pentru a vedea alte oferte.'
                  : 'Creează prima ofertă pentru un client. Conversia în factură se face cu un singur click când acesta acceptă.'
              }
              action={
                !statusFilter && (
                  <Button size="sm" onClick={() => setShowForm(true)}>
                    <Plus size={14} className="mr-1.5" />
                    Ofertă nouă
                  </Button>
                )
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">Număr</th>
                    <th scope="col" className="px-4 py-3 font-medium">Titlu</th>
                    <th scope="col" className="px-4 py-3 font-medium">Status</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Total</th>
                    <th scope="col" className="px-4 py-3 font-medium">Valabilă până</th>
                    <th scope="col" className="px-4 py-3 font-medium text-right">Acțiuni</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((q) => (
                    <tr
                      key={q.id}
                      className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium tabular-nums">
                        {q.number}
                      </td>
                      <td className="px-4 py-3 font-medium">{q.title}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={STATUS_TONES[q.status]}>
                          {STATUS_LABELS[q.status]}
                        </StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                        {formatMoney(q.total, q.currency)}
                      </td>
                      <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                        {new Date(q.validUntil).toLocaleDateString('ro-RO')}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1">
                          {q.status === 'DRAFT' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => statusMut.mutate({ id: q.id, status: 'SENT' })}
                            >
                              Trimite
                            </Button>
                          )}
                          {q.status === 'SENT' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => statusMut.mutate({ id: q.id, status: 'ACCEPTED' })}
                              >
                                Acceptată
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => statusMut.mutate({ id: q.id, status: 'REJECTED' })}
                              >
                                Refuzată
                              </Button>
                            </>
                          )}
                          {q.status === 'ACCEPTED' && !q.invoiceId && (
                            <Button size="sm" onClick={() => setConvertingQuote(q)}>
                              → Factură
                            </Button>
                          )}
                          {q.invoiceId && (
                            <Link
                              to="/app/invoices"
                              className="rounded-md border border-border/70 bg-card/70 px-2.5 py-1 text-xs text-muted-foreground hover:bg-card"
                            >
                              Vezi factură
                            </Link>
                          )}
                          {['DRAFT', 'REJECTED', 'EXPIRED'].includes(q.status) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleDelete(q)}
                              aria-label="Șterge ofertă"
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
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

      {convertingQuote && (
        <ConvertDialog
          quote={convertingQuote}
          onClose={() => setConvertingQuote(null)}
          onConverted={() => {
            void qc.invalidateQueries({ queryKey: ['quotes'] });
            void qc.invalidateQueries({ queryKey: ['invoices'] });
            setConvertingQuote(null);
          }}
        />
      )}
    </div>
  );
}

// ── Create form ──────────────────────────────────────────────────────────────

interface LineState {
  description: string;
  quantity: string;
  unitPrice: string;
  vatRate: string;
}

function emptyLine(): LineState {
  return { description: '', quantity: '1', unitPrice: '0', vatRate: '19' };
}

function NewQuoteForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [validUntil, setValidUntil] = useState(inDaysIso(30));
  const [currency, setCurrency] = useState<QuoteCurrency>('RON');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineState[]>([emptyLine()]);
  const [err, setErr] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: () =>
      quotesApi.create({
        companyId,
        title,
        issueDate,
        validUntil,
        currency,
        notes: notes || undefined,
        lines: lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          vatRate: l.vatRate,
        })),
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['quotes'] });
      onDone();
    },
    onError: (e: unknown) => {
      setErr(e instanceof ApiError ? e.message : 'Eroare la salvare');
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setErr(null);
    if (!companyId.trim()) {
      setErr('ID companie este obligatoriu');
      return;
    }
    if (!title.trim()) {
      setErr('Titlul este obligatoriu');
      return;
    }
    if (lines.some((l) => !l.description.trim())) {
      setErr('Toate liniile trebuie să aibă descriere');
      return;
    }
    createMut.mutate();
  }

  function updateLine(i: number, field: keyof LineState, val: string): void {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: val } : l)));
  }

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Ofertă nouă</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="q-companyId">ID Companie *</Label>
            <Input
              id="q-companyId"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              placeholder="cuid al companiei"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-title">Titlu ofertă *</Label>
            <Input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-issue">Data emiterii</Label>
            <Input
              id="q-issue"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-valid">Valabilă până</Label>
            <Input
              id="q-valid"
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="q-currency">Monedă</Label>
            <select
              id="q-currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value as QuoteCurrency)}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="RON">RON</option>
              <option value="EUR">EUR</option>
              <option value="USD">USD</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Linii ofertă</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setLines((p) => [...p, emptyLine()])}
            >
              <Plus size={14} className="mr-1" /> Linie
            </Button>
          </div>
          {lines.map((line, i) => (
            <div
              key={i}
              className="grid grid-cols-12 gap-2 rounded-md border border-border/70 bg-card/50 p-2"
            >
              <div className="col-span-5">
                <Input
                  placeholder="Descriere"
                  value={line.description}
                  onChange={(e) => updateLine(i, 'description', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Input
                  placeholder="Cantitate"
                  className="tabular-nums"
                  value={line.quantity}
                  onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Input
                  placeholder="Preț/u"
                  className="tabular-nums"
                  value={line.unitPrice}
                  onChange={(e) => updateLine(i, 'unitPrice', e.target.value)}
                />
              </div>
              <div className="col-span-2">
                <Input
                  placeholder="TVA%"
                  className="tabular-nums"
                  value={line.vatRate}
                  onChange={(e) => updateLine(i, 'vatRate', e.target.value)}
                />
              </div>
              <div className="col-span-1 flex items-center justify-center">
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                    className="text-destructive hover:text-destructive/80"
                    aria-label="Șterge linie"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="q-notes">Note</Label>
          <textarea
            id="q-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        {err && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Anulează
          </Button>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Se salvează…' : 'Salvează oferta'}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}

// ── Convert to invoice dialog ────────────────────────────────────────────────

function ConvertDialog({
  quote,
  onClose,
  onConverted,
}: {
  quote: Quote;
  onClose: () => void;
  onConverted: () => void;
}): JSX.Element {
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(inDaysIso(30));
  const [series, setSeries] = useState('AMS');
  const [err, setErr] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => quotesApi.convertToInvoice(quote.id, { issueDate, dueDate, series }),
    onSuccess: onConverted,
    onError: (e: unknown) => setErr(e instanceof ApiError ? e.message : 'Eroare'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <GlassCard elevation="elevated" className="w-full max-w-sm p-6">
        <header className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold">
            Convertește în factură — {quote.number}
          </h2>
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
          <div className="space-y-1.5">
            <Label htmlFor="conv-series">Serie factură</Label>
            <Input
              id="conv-series"
              value={series}
              onChange={(e) => setSeries(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-issue">Data emiterii</Label>
            <Input
              id="conv-issue"
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="conv-due">Scadentă la</Label>
            <Input
              id="conv-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          {err && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {err}
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
              Anulează
            </Button>
            <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
              {mut.isPending ? 'Se procesează…' : 'Creează factură'}
            </Button>
          </div>
        </div>
      </GlassCard>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function inDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(Number(amount));
}

const STATUS_LABELS: Record<QuoteStatus, string> = {
  DRAFT: 'Schiță',
  SENT: 'Trimisă',
  ACCEPTED: 'Acceptată',
  REJECTED: 'Refuzată',
  EXPIRED: 'Expirată',
};

const STATUS_TONES: Record<QuoteStatus, StatusBadgeTone> = {
  DRAFT: 'neutral',
  SENT: 'blue',
  ACCEPTED: 'green',
  REJECTED: 'pink',
  EXPIRED: 'amber',
};
