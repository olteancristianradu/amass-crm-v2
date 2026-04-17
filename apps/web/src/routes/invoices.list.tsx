import { createRoute, Link } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, useRef } from 'react';
import { authedRoute } from './authed';
import { invoicesApi } from '@/features/invoices/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Invoice, InvoiceStatus, PaymentMethod } from '@/lib/types';
import { downloadCsv } from '@/lib/csv';

export const invoicesListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/invoices',
  component: InvoicesListPage,
});

// ── Payment dialog state ──────────────────────────────────────────────────────

interface PaymentFormState {
  amount: string;
  method: PaymentMethod;
  paidAt: string;
  reference: string;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Page ──────────────────────────────────────────────────────────────────────

function InvoicesListPage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', 'list'],
    queryFn: () => invoicesApi.list({ limit: 50 }),
  });

  const [payingInvoice, setPayingInvoice] = useState<Invoice | null>(null);

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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Facturi</h1>
        <Button variant="outline" size="sm" onClick={handleExportCsv}>Export CSV</Button>
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {data && data.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nicio factură emisă. Creează una din detaliul unei companii.
        </p>
      )}
      <div className="space-y-2">
        {data?.data.map((inv) => (
          <Card key={inv.id}>
            <CardContent className="flex items-center justify-between py-3">
              <div>
                <Link
                  to="/app/companies/$id"
                  params={{ id: inv.companyId }}
                  className="font-medium hover:underline"
                >
                  {inv.series}-{String(inv.number).padStart(4, '0')}
                </Link>
                <p className="text-xs text-muted-foreground">
                  Emisă {new Date(inv.issueDate).toLocaleDateString('ro-RO')} · scadentă{' '}
                  {new Date(inv.dueDate).toLocaleDateString('ro-RO')}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="font-mono text-sm">
                  {formatMoney(inv.total, inv.currency)}
                </span>
                <StatusBadge status={inv.status} />
                {inv.status !== 'PAID' && inv.status !== 'CANCELLED' && (
                  <button
                    type="button"
                    onClick={() => setPayingInvoice(inv)}
                    className="rounded bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                  >
                    Înregistrează plată
                  </button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {payingInvoice && (
        <PaymentDialog
          invoice={payingInvoice}
          onClose={() => setPayingInvoice(null)}
        />
      )}
    </div>
  );
}

// ── Payment dialog (fixed overlay, no external modal lib) ─────────────────────

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

  // Close on overlay click (not on dialog click)
  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>): void {
    if (e.target === overlayRef.current) {
      onClose();
    }
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
    /* Full-screen overlay */
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      {/* Dialog box */}
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">
          Înregistrează plată — {invoiceLabel}
        </h2>
        <p className="mb-4 text-sm text-muted-foreground">
          Total factură: {formatMoney(invoice.total, invoice.currency)}
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Amount */}
          <div className="flex flex-col gap-1">
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
              className="rounded border border-input px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Method */}
          <div className="flex flex-col gap-1">
            <label htmlFor="pay-method" className="text-sm font-medium">
              Metodă de plată
            </label>
            <select
              id="pay-method"
              value={form.method}
              onChange={(e) => setForm((f) => ({ ...f, method: e.target.value as PaymentMethod }))}
              className="rounded border border-input px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="BANK">Transfer bancar</option>
              <option value="CARD">Card</option>
              <option value="CASH">Numerar</option>
              <option value="OTHER">Alt mod</option>
            </select>
          </div>

          {/* Date */}
          <div className="flex flex-col gap-1">
            <label htmlFor="pay-date" className="text-sm font-medium">
              Data plății
            </label>
            <input
              id="pay-date"
              type="date"
              required
              value={form.paidAt}
              onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))}
              className="rounded border border-input px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Reference (optional) */}
          <div className="flex flex-col gap-1">
            <label htmlFor="pay-ref" className="text-sm font-medium">
              Referință (opțional)
            </label>
            <input
              id="pay-ref"
              type="text"
              value={form.reference}
              onChange={(e) => setForm((f) => ({ ...f, reference: e.target.value }))}
              placeholder="ex: OP1234 / chitanță #5"
              className="rounded border border-input px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={mutation.isPending}
              className="rounded px-4 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Anulează
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {mutation.isPending ? 'Se salvează…' : 'Salvează plata'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: InvoiceStatus }): JSX.Element {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${statusClasses(status)}`}>
      {statusLabel(status)}
    </span>
  );
}

function statusLabel(s: InvoiceStatus): string {
  return (
    {
      DRAFT: 'Schiță',
      ISSUED: 'Emisă',
      PARTIALLY_PAID: 'Parțial plătită',
      PAID: 'Plătită',
      OVERDUE: 'Restantă',
      CANCELLED: 'Anulată',
    } as Record<InvoiceStatus, string>
  )[s];
}

function statusClasses(s: InvoiceStatus): string {
  switch (s) {
    case 'PAID':
      return 'bg-green-100 text-green-800';
    case 'OVERDUE':
      return 'bg-red-100 text-red-800';
    case 'PARTIALLY_PAID':
      return 'bg-yellow-100 text-yellow-800';
    case 'CANCELLED':
      return 'bg-gray-200 text-gray-600';
    case 'ISSUED':
      return 'bg-blue-100 text-blue-800';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(n);
}
