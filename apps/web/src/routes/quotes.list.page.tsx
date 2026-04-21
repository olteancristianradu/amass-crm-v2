import { Link } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { quotesApi, type Quote, type QuoteStatus, type QuoteCurrency } from '@/features/quotes/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Oferte comerciale</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>Export CSV</Button>
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Anulează' : '+ Ofertă nouă'}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as QuoteStatus | '')}
          className="rounded border border-input px-3 py-1.5 text-sm"
        >
          <option value="">Toate statusurile</option>
          <option value="DRAFT">Schiță</option>
          <option value="SENT">Trimisă</option>
          <option value="ACCEPTED">Acceptată</option>
          <option value="REJECTED">Refuzată</option>
          <option value="EXPIRED">Expirată</option>
        </select>
      </div>

      {showForm && <NewQuoteForm onDone={() => setShowForm(false)} />}

      {isLoading && <Card><TableSkeleton rows={5} cols={6} /></Card>}
      {isError && (
        <p className="text-sm text-destructive">
          {error instanceof ApiError ? error.message : 'Eroare la încărcarea ofertelor'}
        </p>
      )}

      {data && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Număr</th>
                  <th scope="col" className="px-4 py-2 font-medium">Titlu</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Total</th>
                  <th scope="col" className="px-4 py-2 font-medium">Valabilă până</th>
                  <th scope="col" className="px-4 py-2 font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      Nicio ofertă. Creează una folosind butonul de mai sus.
                    </td>
                  </tr>
                )}
                {rows.map((q) => (
                  <tr key={q.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-mono text-xs font-medium">{q.number}</td>
                    <td className="px-4 py-2 font-medium">{q.title}</td>
                    <td className="px-4 py-2"><QuoteStatusBadge status={q.status} /></td>
                    <td className="px-4 py-2 font-mono text-sm">{formatMoney(q.total, q.currency)}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(q.validUntil).toLocaleDateString('ro-RO')}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        {q.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={() => statusMut.mutate({ id: q.id, status: 'SENT' })}
                            className="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800 hover:bg-blue-200"
                          >
                            Trimite
                          </button>
                        )}
                        {q.status === 'SENT' && (
                          <>
                            <button
                              type="button"
                              onClick={() => statusMut.mutate({ id: q.id, status: 'ACCEPTED' })}
                              className="rounded bg-green-100 px-2 py-1 text-xs text-green-800 hover:bg-green-200"
                            >
                              Acceptată
                            </button>
                            <button
                              type="button"
                              onClick={() => statusMut.mutate({ id: q.id, status: 'REJECTED' })}
                              className="rounded bg-red-100 px-2 py-1 text-xs text-red-800 hover:bg-red-200"
                            >
                              Refuzată
                            </button>
                          </>
                        )}
                        {q.status === 'ACCEPTED' && !q.invoiceId && (
                          <button
                            type="button"
                            onClick={() => setConvertingQuote(q)}
                            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
                          >
                            → Factură
                          </button>
                        )}
                        {q.invoiceId && (
                          <Link
                            to="/app/invoices"
                            className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700"
                          >
                            Vezi factură
                          </Link>
                        )}
                        {['DRAFT', 'REJECTED', 'EXPIRED'].includes(q.status) && (
                          <button
                            type="button"
                            onClick={() => handleDelete(q)}
                            className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive hover:bg-destructive/20"
                          >
                            Șterge
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
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
    if (!companyId.trim()) { setErr('ID companie este obligatoriu'); return; }
    if (!title.trim()) { setErr('Titlul este obligatoriu'); return; }
    if (lines.some((l) => !l.description.trim())) { setErr('Toate liniile trebuie să aibă descriere'); return; }
    createMut.mutate();
  }

  function updateLine(i: number, field: keyof LineState, val: string): void {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: val } : l)));
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Ofertă nouă</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="q-companyId">ID Companie *</Label>
              <Input id="q-companyId" value={companyId} onChange={(e) => setCompanyId(e.target.value)} placeholder="cuid al companiei" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="q-title">Titlu ofertă *</Label>
              <Input id="q-title" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="q-issue">Data emiterii</Label>
              <Input id="q-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="q-valid">Valabilă până</Label>
              <Input id="q-valid" type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="q-currency">Monedă</Label>
              <select
                id="q-currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value as QuoteCurrency)}
                className="flex h-9 w-full rounded-md border border-input px-3 py-1 text-sm"
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
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>
                + Linie
              </Button>
            </div>
            {lines.map((line, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 rounded border p-2">
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
                    value={line.quantity}
                    onChange={(e) => updateLine(i, 'quantity', e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    placeholder="Preț/u"
                    value={line.unitPrice}
                    onChange={(e) => updateLine(i, 'unitPrice', e.target.value)}
                  />
                </div>
                <div className="col-span-2">
                  <Input
                    placeholder="TVA%"
                    value={line.vatRate}
                    onChange={(e) => updateLine(i, 'vatRate', e.target.value)}
                  />
                </div>
                <div className="col-span-1 flex items-center justify-center">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((p) => p.filter((_, idx) => idx !== i))}
                      className="text-destructive hover:text-destructive/80 text-lg leading-none"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="q-notes">Note</Label>
            <textarea
              id="q-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded border border-input px-3 py-2 text-sm"
            />
          </div>

          {err && <p className="text-sm text-destructive">{err}</p>}
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Se salvează…' : 'Salvează oferta'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ── Convert to invoice dialog ────────────────────────────────────────────────

function ConvertDialog({ quote, onClose, onConverted }: {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Convertește în factură — {quote.number}</h2>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="conv-series">Serie factură</Label>
            <Input id="conv-series" value={series} onChange={(e) => setSeries(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="conv-issue">Data emiterii</Label>
            <Input id="conv-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="conv-due">Scadentă la</Label>
            <Input id="conv-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={mut.isPending}>Anulează</Button>
            <Button onClick={() => mut.mutate()} disabled={mut.isPending}>
              {mut.isPending ? 'Se procesează…' : 'Creează factură'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function todayIso(): string { return new Date().toISOString().slice(0, 10); }
function inDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(Number(amount));
}

const STATUS_BADGE: Record<QuoteStatus, { label: string; cls: string }> = {
  DRAFT:    { label: 'Schiță',   cls: 'bg-gray-100 text-gray-700' },
  SENT:     { label: 'Trimisă',  cls: 'bg-blue-100 text-blue-800' },
  ACCEPTED: { label: 'Acceptată', cls: 'bg-green-100 text-green-800' },
  REJECTED: { label: 'Refuzată', cls: 'bg-red-100 text-red-800' },
  EXPIRED:  { label: 'Expirată', cls: 'bg-yellow-100 text-yellow-700' },
};

function QuoteStatusBadge({ status }: { status: QuoteStatus }): JSX.Element {
  const { label, cls } = STATUS_BADGE[status] ?? { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>;
}
