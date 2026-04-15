import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { authedRoute } from './authed';
import { invoicesApi } from '@/features/invoices/api';
import { Card, CardContent } from '@/components/ui/card';
import type { InvoiceStatus } from '@/lib/types';

export const invoicesListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/invoices',
  component: InvoicesListPage,
});

function InvoicesListPage(): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['invoices', 'list'],
    queryFn: () => invoicesApi.list({ limit: 50 }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Facturi</h1>
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

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
