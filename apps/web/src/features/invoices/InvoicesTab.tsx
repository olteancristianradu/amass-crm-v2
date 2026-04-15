import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { invoicesApi, CreateInvoiceLineInput } from './api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import type { InvoiceCurrency, InvoiceStatus } from '@/lib/types';

interface Props {
  companyId: string;
}

export function InvoicesTab({ companyId }: Props): JSX.Element {
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ['invoices', 'by-company', companyId],
    queryFn: () => invoicesApi.list({ companyId, limit: 50 }),
  });

  const [showForm, setShowForm] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Facturi</h3>
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : 'Factură nouă'}
        </Button>
      </div>

      {showForm && (
        <NewInvoiceForm
          companyId={companyId}
          onSaved={async () => {
            setShowForm(false);
            await qc.invalidateQueries({ queryKey: ['invoices', 'by-company', companyId] });
            await qc.invalidateQueries({ queryKey: ['invoices', 'list'] });
          }}
        />
      )}

      {listQ.isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {listQ.data && listQ.data.data.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">Nicio factură emisă.</p>
      )}
      <ul className="space-y-2">
        {listQ.data?.data.map((inv) => (
          <li key={inv.id} className="relative rounded-md border bg-background p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">
                    {inv.series}-{String(inv.number).padStart(4, '0')}
                  </span>
                  <StatusBadge status={inv.status} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Emisă {new Date(inv.issueDate).toLocaleDateString('ro-RO')} · scadentă{' '}
                  {new Date(inv.dueDate).toLocaleDateString('ro-RO')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-mono text-sm">
                  {formatMoney(inv.total, inv.currency)}
                </span>
                {inv.status === 'DRAFT' && (
                  <IssueButton id={inv.id} onIssued={() =>
                    qc.invalidateQueries({ queryKey: ['invoices', 'by-company', companyId] })
                  } />
                )}
                {['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status) && (
                  <PayButton
                    invoiceId={inv.id}
                    remaining={Number(inv.total)}
                    currency={inv.currency}
                    onPaid={() =>
                      qc.invalidateQueries({ queryKey: ['invoices', 'by-company', companyId] })
                    }
                  />
                )}
                {inv.status !== 'DRAFT' && <PdfButton id={inv.id} />}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function IssueButton({ id, onIssued }: { id: string; onIssued: () => void }): JSX.Element {
  const m = useMutation({
    mutationFn: () => invoicesApi.changeStatus(id, 'ISSUED'),
    onSuccess: onIssued,
  });
  return (
    <Button size="sm" variant="outline" disabled={m.isPending} onClick={() => m.mutate()}>
      {m.isPending ? '…' : 'Emite'}
    </Button>
  );
}

function PdfButton({ id }: { id: string }): JSX.Element {
  const [loading, setLoading] = useState(false);
  const open = async (): Promise<void> => {
    setLoading(true);
    try {
      const { url } = await invoicesApi.pdfUrl(id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } finally {
      setLoading(false);
    }
  };
  return (
    <Button size="sm" variant="ghost" disabled={loading} onClick={open}>
      {loading ? '…' : 'PDF'}
    </Button>
  );
}

function PayButton({
  invoiceId,
  remaining,
  currency,
  onPaid,
}: {
  invoiceId: string;
  remaining: number;
  currency: string;
  onPaid: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(remaining.toFixed(2));
  const [paidAt, setPaidAt] = useState(today());
  const [method, setMethod] = useState('BANK');
  const [reference, setReference] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const record = useMutation({
    mutationFn: () =>
      invoicesApi.createPayment(invoiceId, {
        amount,
        paidAt: new Date(paidAt).toISOString(),
        method: method as 'BANK' | 'CASH' | 'CARD' | 'OTHER',
        reference: reference.trim() || undefined,
      }),
    onSuccess: () => {
      setOpen(false);
      onPaid();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Eroare'),
  });

  if (!open) {
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        Înregistrează plată
      </Button>
    );
  }
  return (
    <div className="absolute right-0 z-10 mt-2 w-80 rounded-md border bg-background p-3 shadow-lg">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          record.mutate();
        }}
        className="space-y-2"
      >
        <Label>Sumă ({currency})</Label>
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} />
        <Label>Data plății</Label>
        <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        <Label>Metodă</Label>
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        >
          <option value="BANK">Transfer bancar</option>
          <option value="CASH">Numerar</option>
          <option value="CARD">Card</option>
          <option value="OTHER">Altă</option>
        </select>
        <Label>Referință</Label>
        <Input
          placeholder="Nr. OP / chitanță"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
        />
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Anulează
          </Button>
          <Button type="submit" size="sm" disabled={record.isPending}>
            {record.isPending ? '…' : 'Salvează'}
          </Button>
        </div>
      </form>
    </div>
  );
}


interface FormProps {
  companyId: string;
  onSaved: () => void | Promise<void>;
}

interface LineState extends CreateInvoiceLineInput {
  key: string;
}

function NewInvoiceForm({ companyId, onSaved }: FormProps): JSX.Element {
  const [series, setSeries] = useState('AMS');
  const [issueDate, setIssueDate] = useState(today());
  const [dueDate, setDueDate] = useState(inDays(14));
  const [currency, setCurrency] = useState<InvoiceCurrency>('RON');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineState[]>([
    { key: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '0', vatRate: '19' },
  ]);
  const [err, setErr] = useState<string | null>(null);

  const totals = useMemo(() => computeTotals(lines), [lines]);

  const create = useMutation({
    mutationFn: () =>
      invoicesApi.create({
        companyId,
        series: series.trim() || 'AMS',
        issueDate: new Date(issueDate).toISOString(),
        dueDate: new Date(dueDate).toISOString(),
        currency,
        notes: notes.trim() || undefined,
        lines: lines.map(({ key: _k, ...l }) => l),
      }),
    onSuccess: async () => {
      setErr(null);
      await onSaved();
    },
    onError: (e) => setErr(e instanceof ApiError ? e.message : 'Eroare la salvare'),
  });

  const update = (i: number, patch: Partial<CreateInvoiceLineInput>): void => {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  };
  const addLine = (): void =>
    setLines((prev) => [
      ...prev,
      { key: crypto.randomUUID(), description: '', quantity: '1', unitPrice: '0', vatRate: '19' },
    ]);
  const removeLine = (i: number): void =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (lines.some((l) => !l.description.trim())) {
          setErr('Fiecare linie are nevoie de descriere.');
          return;
        }
        create.mutate();
      }}
      className="space-y-4 rounded-md border bg-muted/30 p-4"
    >
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label>Serie</Label>
          <Input value={series} onChange={(e) => setSeries(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Data emiterii</Label>
          <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Scadență</Label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>Monedă</Label>
          <select
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as InvoiceCurrency)}
          >
            <option value="RON">RON</option>
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Linii</Label>
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            + Linie
          </Button>
        </div>
        {lines.map((l, i) => (
          <div key={l.key} className="grid gap-2 md:grid-cols-[1fr_80px_120px_80px_auto]">
            <Input
              placeholder="Descriere"
              value={l.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
            <Input
              placeholder="Cant."
              value={l.quantity}
              onChange={(e) => update(i, { quantity: e.target.value })}
            />
            <Input
              placeholder="Preț unit."
              value={l.unitPrice}
              onChange={(e) => update(i, { unitPrice: e.target.value })}
            />
            <Input
              placeholder="TVA %"
              value={l.vatRate ?? '19'}
              onChange={(e) => update(i, { vatRate: e.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => removeLine(i)}
              disabled={lines.length === 1}
            >
              ×
            </Button>
          </div>
        ))}
      </div>

      <div className="space-y-1">
        <Label>Note</Label>
        <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="flex items-center justify-between border-t pt-3 text-sm">
        <div className="space-y-1">
          <p>Subtotal: <span className="font-mono">{totals.subtotal.toFixed(2)}</span></p>
          <p>TVA: <span className="font-mono">{totals.vat.toFixed(2)}</span></p>
          <p className="font-semibold">Total: <span className="font-mono">{totals.total.toFixed(2)}</span> {currency}</p>
        </div>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Se salvează…' : 'Salvează schiță'}
        </Button>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
    </form>
  );
}

function StatusBadge({ status }: { status: InvoiceStatus }): JSX.Element {
  const cls: Record<InvoiceStatus, string> = {
    DRAFT: 'bg-gray-100 text-gray-700',
    ISSUED: 'bg-blue-100 text-blue-800',
    PARTIALLY_PAID: 'bg-yellow-100 text-yellow-800',
    PAID: 'bg-green-100 text-green-800',
    OVERDUE: 'bg-red-100 text-red-800',
    CANCELLED: 'bg-gray-200 text-gray-500',
  };
  const labels: Record<InvoiceStatus, string> = {
    DRAFT: 'Schiță',
    ISSUED: 'Emisă',
    PARTIALLY_PAID: 'Parțial',
    PAID: 'Plătită',
    OVERDUE: 'Restantă',
    CANCELLED: 'Anulată',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cls[status]}`}>
      {labels[status]}
    </span>
  );
}

function computeTotals(lines: CreateInvoiceLineInput[]): {
  subtotal: number;
  vat: number;
  total: number;
} {
  let subtotal = 0;
  let vat = 0;
  for (const l of lines) {
    const q = Number(l.quantity) || 0;
    const u = Number(l.unitPrice) || 0;
    const r = Number(l.vatRate ?? '19') || 0;
    const lineSubtotal = round2(q * u);
    const lineVat = round2((lineSubtotal * r) / 100);
    subtotal += lineSubtotal;
    vat += lineVat;
  }
  return { subtotal, vat, total: round2(subtotal + vat) };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function inDays(n: number): string {
  return new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
}

function formatMoney(amount: string, currency: string): string {
  const n = Number(amount);
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(n);
}
