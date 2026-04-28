import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useState } from 'react';
import { authedRoute } from './authed';
import { exportsApi, type RequestExportDto, type ExportEntityType } from '@/features/exports/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ApiError } from '@/lib/api';
import { statusBadgeClasses, type StatusTone } from '@/lib/status-colors';

export const exportsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/exports',
  component: ExportsPage,
});

// Token-based pill colors — themed via lib/status-colors.ts.
const STATUS_TONES: Record<string, StatusTone> = {
  PENDING: 'warning',
  PROCESSING: 'info',
  DONE: 'success',
  FAILED: 'danger',
};

const ENTITY_LABELS: Record<ExportEntityType, string> = {
  companies: 'Companii',
  contacts: 'Contacte',
  deals: 'Deal-uri',
  invoices: 'Facturi',
  quotes: 'Oferte',
  activities: 'Activități',
};

function ExportsPage(): JSX.Element {
  const [showForm, setShowForm] = useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['exports'],
    queryFn: () => exportsApi.list(),
    // Auto-refresh every 5s when there are PENDING or PROCESSING exports
    refetchInterval: (query) => {
      const rows = query.state.data?.data ?? [];
      const hasActive = rows.some(
        (e) => e.status === 'PENDING' || e.status === 'PROCESSING',
      );
      return hasActive ? 5000 : false;
    },
  });

  const exports = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Exporturi</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Export nou'}
        </Button>
      </div>

      {showForm && <RequestExportForm onDone={() => setShowForm(false)} />}

      {isLoading && <div className="animate-pulse h-8 bg-gray-100 rounded w-full" />}
      {isError && (
        <p className="text-red-500 text-sm">
          {error instanceof ApiError ? error.message : String(error)}
        </p>
      )}

      {data && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Entitate</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium">Rânduri</th>
                  <th scope="col" className="px-4 py-2 font-medium">Creat</th>
                  <th scope="col" className="px-4 py-2 font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {exports.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Niciun export. Solicită primul export folosind butonul de mai sus.
                    </td>
                  </tr>
                )}
                {exports.map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">
                      {ENTITY_LABELS[e.entityType as ExportEntityType] ?? e.entityType}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={statusBadgeClasses(STATUS_TONES[e.status] ?? 'neutral')}
                      >
                        {e.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {e.rowCount != null ? e.rowCount.toLocaleString('ro-RO') : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString('ro-RO')}
                    </td>
                    <td className="px-4 py-2">
                      {e.status === 'DONE' && (
                        <DownloadButton exportId={e.id} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function DownloadButton({ exportId }: { exportId: string }): JSX.Element {
  const downloadMut = useMutation({
    mutationFn: () => exportsApi.downloadUrl(exportId),
    onSuccess: (res) => {
      window.open(res.url, '_blank', 'noopener,noreferrer');
    },
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={downloadMut.isPending}
      onClick={() => downloadMut.mutate()}
    >
      {downloadMut.isPending ? 'Se descarcă…' : 'Descarcă'}
    </Button>
  );
}

function RequestExportForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<RequestExportDto>({
    defaultValues: { entityType: 'companies' },
  });

  const requestMut = useMutation({
    mutationFn: (dto: RequestExportDto) => exportsApi.request(dto),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['exports'] });
      reset();
      onDone();
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Export nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit((v) => requestMut.mutate(v))}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1">
            <Label htmlFor="entityType">Tip entitate *</Label>
            <select
              id="entityType"
              {...register('entityType', { required: 'Selectează tipul' })}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="companies">Companii</option>
              <option value="contacts">Contacte</option>
              <option value="deals">Deal-uri</option>
              <option value="invoices">Facturi</option>
              <option value="quotes">Oferte</option>
              <option value="activities">Activități</option>
            </select>
            {errors.entityType && (
              <p className="text-xs text-destructive">{errors.entityType.message}</p>
            )}
          </div>

          <div className="md:col-span-2 flex items-end">
            {requestMut.isError && (
              <p className="mb-2 mr-4 text-sm text-destructive">
                {requestMut.error instanceof ApiError
                  ? requestMut.error.message
                  : 'Eroare la solicitare'}
              </p>
            )}
            <Button type="submit" disabled={isSubmitting || requestMut.isPending}>
              {requestMut.isPending ? 'Se solicită…' : 'Solicită export'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
