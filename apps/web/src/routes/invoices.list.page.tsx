import { Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { Download, Plus, Receipt, X } from 'lucide-react';
import { invoicesApi, type CreateInvoiceInput } from '@/features/invoices/api';
import { companiesApi } from '@/features/companies/api';
import { AnafInvoiceCell } from '@/features/anaf/AnafInvoiceCell';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  type StatusBadgeTone,
} from '@/components/ui/page-header';
import type { Invoice, InvoiceStatus, PaymentMethod } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';
import { QueryError } from '@/components/ui/QueryError';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { useTour } from '@/lib/tours/useTour';

interface PaymentFormState {
  amount: string;
  method: PaymentMethod;
  paidAt: string;
  reference: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function InvoicesListPage(): JSX.Element {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['invoices', 'list'],
    queryFn: () => invoicesApi.list({ limit: 50 }),
  });

  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // F1.12 — auto-launch product tour on first visit (self-skips if completed).
  useTour('invoices-list');

  function handleExportCsv(): void {
    const rows = (data?.data ?? []).map((inv) => ({
      Serie: inv.series,
      Numar: String(inv.number).padStart(4, '0'),
      Status: inv.status,
      Total: inv.total,
      Moneda: inv.currency,
      'Data emitere': new Date(inv.issueDate).toLocaleDateString('ro-RO'),
      'Data scadenta': new Date(inv.dueDate).toLocaleDateString('ro-RO'),
    }));
    downloadCsv(rows, `facturi-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  const rows = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Facturi"
        subtitle="Toate facturile emise — DRAFT, ISSUED, PAID, OVERDUE, CANCELLED."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              data-tour="invoices-export-btn"
            >
              <Download size={14} className="mr-1.5" />
              Export
            </Button>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus size={14} className="mr-1.5" />
              Factură nouă
            </Button>
          </div>
        }
      />

      {showCreate && <NewInvoiceForm onDone={() => setShowCreate(false)} />}

      {isLoading && (
        <GlassCard className="overflow-hidden">
          <TableSkeleton rows={5} cols={4} />
        </GlassCard>
      )}
      <QueryError isError={isError} error={error} label="Nu am putut încărca facturile." />

      {data && rows.length === 0 && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={Receipt}
            title="Nicio factură emisă"
            description="Creează factura din detaliul unei companii (nu din această pagină) — pleacă întotdeauna dintr-un client real ca să nu rămână orfană."
          />
        </GlassCard>
      )}

      <div className="space-y-2" data-tour="invoices-table">
        {rows.map((inv) => (
          <GlassCard key={inv.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Link
                  to="/app/companies/$id"
                  params={{ id: inv.companyId }}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {inv.series}-{String(inv.number).padStart(4, '0')}
                </Link>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Emisă {new Date(inv.issueDate).toLocaleDateString('ro-RO')} · scadentă{' '}
                  {new Date(inv.dueDate).toLocaleDateString('ro-RO')}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-sm tabular-nums">
                  {formatMoney(inv.total, inv.currency)}
                </span>
                <StatusBadge tone={STATUS_TONES[inv.status]}>
                  {STATUS_LABELS[inv.status]}
                </StatusBadge>
                {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                  <Button size="sm" onClick={() => setPayingInvoice(inv)}>
                    Înregistrează plată
                  </Button>
                )}
              </div>
            </div>
            {inv.status !== 'DRAFT' && inv.status !== 'CANCELLED' && (
              <div className="mt-3 border-t border-border/50 pt-3">
                <AnafInvoiceCell invoiceId={inv.id} />
              </div>
            )}
          </GlassCard>
        ))}
      </div>

      {payingInvoice && (
        <PaymentDialog invoice={payingInvoice} onClose={() => setPayingInvoice(null)} />
      )}
    </div>
  );
}

interface PaymentDialogProps {
  invoice: Invoice;
  onClose: () => void;
}

function PaymentDialog({ invoice, onClose }: PaymentDialogProps): JSX.Element {
  const qc = useQueryClient();
  const overlayRef = useRef<HTMLDivElement>(null);

  const [form, setForm] = useState<PaymentFormState>({
    amount: invoice.total,
    method: 'BANK',
    paidAt: todayIso(),
    reference: '',
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      invoicesApi.createPayment(invoice.id, {
        amount: form.amount,
        method: form.method,
        paidAt: form.paidAt,
        reference: form.reference || undefined,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['invoices', 'list'] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : 'Eroare la înregistrarea plății.';
      setError(msg);
    },
  });

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === overlayRef.current) onClose();
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setError(null);
    const amt = Number(form.amount);
    if (!form.amount || isNaN(amt) || amt <= 0) {
      setError('Suma trebuie să fie un număr pozitiv.');
      return;
    }
    if (!form.paidAt) {
      setError('Data plății este obligatorie.');
      return;
    }
    mutation.mutate();
  }

  const invoiceLabel = `${invoice.series}-${String(invoice.number).padStart(4, '0')}`;

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
    >
      <GlassCard elevation="elevated" className="w-full max-w-md p-6">
        <header className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">
              Înregistrează plată — {invoiceLabel}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Total factură: <span className="tabular-nums">{formatMoney(invoice.total, invoice.currency)}</span>
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label htmlFor="pay-amount" className="text-sm font-medium">
              Sumă ({invoice.currency})
            </label>
            <input
              id="pay-amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pay-method" className="text-sm font-medium">
              Metodă de plată
            </label>
            <select
              id="pay-method"
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as PaymentMethod }))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <option value="BANK">Transfer bancar</option>
              <option value="CARD">Card</option>
              <option value="CASH">Numerar</option>
              <option value="OTHER">Alt mod</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pay-date" className="text-sm font-medium">
              Data plății
            </label>
            <input
              id="pay-date"
              type="date"
              required
              value={form.paidAt}
              onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="pay-ref" className="text-sm font-medium">
              Referință (opțional)
            </label>
            <input
              id="pay-ref"
              type="text"
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              placeholder="ex: OP1234 / chitanță #5"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          </div>

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Anulează
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? 'Se salvează…' : 'Salvează plata'}
            </Button>
          </div>
        </form>
      </GlassCard>
    </div>
  );
}

const STATUS_LABELS: Record<InvoiceStatus, string> = {
  DRAFT: 'Schiță',
  ISSUED: 'Emisă',
  PARTIALLY_PAID: 'Parțial plătită',
  PAID: 'Plătită',
  OVERDUE: 'Restantă',
  CANCELLED: 'Anulată',
};

const STATUS_TONES: Record<InvoiceStatus, StatusBadgeTone> = {
  DRAFT: 'neutral',
  ISSUED: 'blue',
  PARTIALLY_PAID: 'amber',
  PAID: 'green',
  OVERDUE: 'pink',
  CANCELLED: 'neutral',
};

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(n);
}

function NewInvoiceForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState('');
  const [issueDate, setIssueDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    return d.toISOString().slice(0, 10);
  });
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unitPrice, setUnitPrice] = useState('');
  const [vatRate, setVatRate] = useState('19');

  const companies = useQuery({
    queryKey: ['companies', 'for-invoice-create'],
    queryFn: () => companiesApi.list(undefined, 50),
  });

  const createMut = useMutation({
    mutationFn: (dto: CreateInvoiceInput) => invoicesApi.create(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['invoices'] });
      onDone();
    },
  });

  function submit(e: React.FormEvent): void {
    e.preventDefault();
    if (!companyId || !description.trim() || !unitPrice) return;
    const dto: CreateInvoiceInput = {
      companyId,
      issueDate,
      dueDate,
      lines: [
        {
          description: description.trim(),
          quantity,
          unitPrice,
          vatRate,
        },
      ],
    };
    createMut.mutate(dto);
  }

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Factură nouă</h2>
      <p className="mb-4 text-xs text-muted-foreground">
        Pentru facturi cu mai multe linii sau atașate la deal-uri, creează din pagina
        unui deal sau company. Aici creezi o factură rapidă cu o linie.
      </p>
      <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="i-company">Companie *</Label>
          <select
            id="i-company"
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            required
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">— alege companie —</option>
            {companies.data?.data.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-issue">Dată emitere *</Label>
          <Input
            id="i-issue"
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-due">Dată scadență *</Label>
          <Input
            id="i-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
          />
        </div>
        <div className="md:col-span-2 space-y-1.5">
          <Label htmlFor="i-line">Descriere produs/serviciu *</Label>
          <Input
            id="i-line"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Ex: Consultanță IT — luna octombrie"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-qty">Cantitate *</Label>
          <Input
            id="i-qty"
            type="number"
            step="0.01"
            min="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-price">Preț unitar (RON, fără TVA) *</Label>
          <Input
            id="i-price"
            type="number"
            step="0.01"
            min="0"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder="100.00"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="i-vat">TVA (%)</Label>
          <Input
            id="i-vat"
            type="number"
            step="1"
            min="0"
            max="100"
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
          />
        </div>
        <div className="md:col-span-2">
          {createMut.isError && (
            <p className="mb-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {createMut.error instanceof Error ? createMut.error.message : 'Eroare la salvare'}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onDone}>
              Anulează
            </Button>
            <Button
              type="submit"
              disabled={!companyId || !description.trim() || !unitPrice || createMut.isPending}
            >
              {createMut.isPending ? 'Se emite…' : 'Emite factură'}
            </Button>
          </div>
        </div>
      </form>
    </GlassCard>
  );
}
