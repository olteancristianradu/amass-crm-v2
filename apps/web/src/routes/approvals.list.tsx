import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import {
  approvalsApi,
  type ApprovalStatus,
  type ApprovalDecision,
} from '@/features/approvals/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const approvalsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/approvals',
  component: ApprovalsListPage,
});

const STATUS_LABELS: Record<ApprovalStatus, string> = {
  PENDING: 'În așteptare',
  APPROVED: 'Aprobat',
  REJECTED: 'Respins',
};

const STATUS_COLORS: Record<ApprovalStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
};

function ApprovalsListPage(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState<ApprovalStatus>('PENDING');
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['approvals', statusFilter],
    queryFn: () => approvalsApi.listRequests(statusFilter),
  });

  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Aprobări oferte</h1>
        <div className="flex gap-2">
          {(['PENDING', 'APPROVED', 'REJECTED'] as ApprovalStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === s
                  ? STATUS_COLORS[s]
                  : 'bg-muted text-muted-foreground hover:bg-secondary'
              }`}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <Card>
          <TableSkeleton rows={4} cols={5} />
        </Card>
      )}
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
                  <th className="px-4 py-2 font-medium">Nr. ofertă</th>
                  <th className="px-4 py-2 font-medium">Total</th>
                  <th className="px-4 py-2 font-medium">Solicitat la</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  {statusFilter === 'PENDING' && (
                    <th className="px-4 py-2 font-medium w-40">Acțiuni</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      Nicio cerere de aprobare{' '}
                      {statusFilter === 'PENDING' ? 'în așteptare' : 'în această categorie'}.
                    </td>
                  </tr>
                )}
                {rows.map((req) => (
                  <tr key={req.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium font-mono">{req.quoteNumber}</td>
                    <td className="px-4 py-2 font-mono">
                      {formatMoney(req.quoteTotal, req.currency)}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(req.requestedAt).toLocaleDateString('ro-RO', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[req.status]}`}
                      >
                        {STATUS_LABELS[req.status]}
                      </span>
                    </td>
                    {statusFilter === 'PENDING' && (
                      <td className="px-4 py-2">
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            className="bg-green-600 hover:bg-green-700 text-white text-xs h-7"
                            onClick={() => setDecidingId(req.id)}
                          >
                            Aprobă
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="text-xs h-7"
                            onClick={() => setDecidingId(`reject:${req.id}`)}
                          >
                            Respinge
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Decide dialogs */}
      {decidingId && decidingId.startsWith('reject:') && (
        <DecideDialog
          approvalId={decidingId.replace('reject:', '')}
          decision="REJECTED"
          onClose={() => setDecidingId(null)}
        />
      )}
      {decidingId && !decidingId.startsWith('reject:') && (
        <DecideDialog
          approvalId={decidingId}
          decision="APPROVED"
          onClose={() => setDecidingId(null)}
        />
      )}
    </div>
  );
}

interface DecideDialogProps {
  approvalId: string;
  decision: ApprovalDecision;
  onClose: () => void;
}

function DecideDialog({ approvalId, decision, onClose }: DecideDialogProps): JSX.Element {
  const qc = useQueryClient();
  const [comment, setComment] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const decideMut = useMutation({
    mutationFn: () => approvalsApi.decide(approvalId, { decision, comment: comment || undefined }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['approvals'] });
      onClose();
    },
    onError: (e: unknown) => {
      setErr(e instanceof ApiError ? e.message : 'Eroare la decizie');
    },
  });

  const isApprove = decision === 'APPROVED';
  const title = isApprove ? 'Aprobă oferta' : 'Respinge oferta';
  const btnLabel = isApprove ? 'Aprobă' : 'Respinge';
  const btnClass = isApprove
    ? 'bg-green-600 hover:bg-green-700 text-white'
    : 'bg-destructive hover:bg-destructive/90 text-destructive-foreground';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        <div className="space-y-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="decide-comment" className="text-sm font-medium">
              Comentariu {!isApprove && '*'}
            </label>
            <textarea
              id="decide-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              placeholder={isApprove ? 'Opțional…' : 'Motivul respingerii…'}
              className="rounded border border-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={decideMut.isPending}
              className="rounded px-4 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Anulează
            </button>
            <button
              type="button"
              disabled={decideMut.isPending || (!isApprove && !comment.trim())}
              onClick={() => decideMut.mutate()}
              className={`rounded px-4 py-1.5 text-sm font-medium disabled:opacity-60 ${btnClass}`}
            >
              {decideMut.isPending ? 'Se procesează…' : btnLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatMoney(amount: string, currency: string): string {
  return new Intl.NumberFormat('ro-RO', { style: 'currency', currency }).format(Number(amount));
}
