import { useQuery } from '@tanstack/react-query';
import { Database } from 'lucide-react';
import { api } from '@/lib/api';
import {
  EmptyState,
  ListSurface,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-header';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

type ImportStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELED';

interface ImportJob {
  id: string;
  tenantId: string;
  type: 'COMPANIES' | 'CONTACTS' | 'CLIENTS' | 'LEADS' | 'DEALS' | 'INVOICES';
  status: ImportStatus;
  fileName: string;
  totalRows: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors?: Array<{ row?: number; reason?: string }> | null;
  createdAt: string;
  updatedAt?: string;
  createdById?: string | null;
}

// StatusBadge accepts: neutral | blue | amber | pink | green. We map FAILED
// to `pink` (the design system's "blocked / lost" tone) since there's no
// dedicated red — visually distinct enough from neutral/amber.
const STATUS_TONE: Record<ImportStatus, 'green' | 'amber' | 'pink' | 'neutral' | 'blue'> = {
  COMPLETED: 'green',
  PROCESSING: 'amber',
  PENDING: 'neutral',
  FAILED: 'pink',
  CANCELED: 'neutral',
};

const STATUS_LABEL: Record<ImportStatus, string> = {
  PENDING: 'În așteptare',
  PROCESSING: 'Se procesează',
  COMPLETED: 'Finalizat',
  FAILED: 'Eșuat',
  CANCELED: 'Anulat',
};

const TYPE_LABEL: Record<ImportJob['type'], string> = {
  COMPANIES: 'Companii',
  CONTACTS: 'Contacte',
  CLIENTS: 'Clienți',
  LEADS: 'Lead-uri',
  DEALS: 'Deal-uri',
  INVOICES: 'Facturi',
};

function fmtDate(s: string): string {
  return new Date(s).toLocaleString('ro-RO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ImportsPage(): JSX.Element {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['imports'],
    queryFn: () => api.get<ImportJob[]>('/imports'),
    refetchInterval: (q) => {
      const arr = q.state.data as ImportJob[] | undefined;
      // Poll faster while any job is still running so the UI feels live.
      return arr?.some((j) => j.status === 'PENDING' || j.status === 'PROCESSING')
        ? 3000
        : 30_000;
    },
  });

  if (isError) {
    return (
      <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
        Eroare la încărcarea istoricului: {error instanceof ApiError ? error.message : 'necunoscută'}
      </p>
    );
  }

  return (
    <div>
      <PageHeader
        title="Imports"
        subtitle="Istoric job-uri de import — fiecare fișier urcat (CSV, PDF GestCom etc.) apare aici cu status și statistici."
      />

      {isLoading && (
        <ListSurface>
          <TableSkeleton rows={3} cols={6} />
        </ListSurface>
      )}

      {data && data.length === 0 && (
        <ListSurface>
          <EmptyState
            icon={Database}
            title="Niciun import încă"
            description="Upload-urile prin POST /api/v1/imports?type=... vor apărea aici, cu status, total rânduri, reușite, eșuate."
          />
        </ListSurface>
      )}

      {data && data.length > 0 && (
        <ListSurface>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Fișier</th>
                  <th scope="col" className="px-4 py-3 font-medium">Tip</th>
                  <th scope="col" className="px-4 py-3 font-medium">Status</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Total</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">OK</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Sărite</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Eșuate</th>
                  <th scope="col" className="px-4 py-3 font-medium">Creat la</th>
                </tr>
              </thead>
              <tbody>
                {data.map((j) => {
                  const pct = j.totalRows > 0 ? Math.round((j.processed / j.totalRows) * 100) : 0;
                  return (
                    <tr
                      key={j.id}
                      className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium">{j.fileName}</div>
                        {j.errors && j.errors.length > 0 && (
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {j.errors.length} eroare/eroăvi în log
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{TYPE_LABEL[j.type]}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</StatusBadge>
                        {j.status === 'PROCESSING' && (
                          <div className="mt-1 text-[11px] text-muted-foreground">{pct}%</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono">{j.totalRows.toLocaleString('ro-RO')}</td>
                      <td className="px-4 py-3 text-right font-mono text-emerald-600">{j.succeeded.toLocaleString('ro-RO')}</td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">{j.skipped.toLocaleString('ro-RO')}</td>
                      <td className="px-4 py-3 text-right font-mono text-red-600">{j.failed.toLocaleString('ro-RO')}</td>
                      <td className="px-4 py-3 tabular-nums text-muted-foreground">{fmtDate(j.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ListSurface>
      )}
    </div>
  );
}
