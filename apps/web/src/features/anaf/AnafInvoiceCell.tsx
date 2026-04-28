import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Send, RefreshCw, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/page-header';
import { ApiError } from '@/lib/api';
import {
  anafApi,
  anafStatusLabel,
  anafStatusTone,
  type AnafStatus,
  type StatusResponse,
} from './api';

/**
 * Inline ANAF cell for the invoice list — shows the current submission
 * state (or a "Trimite" button when not yet submitted), and gives the
 * accountant a one-click "Re-verifică" + "Descarcă XML" path. Placed in
 * the right-side cluster of each invoice card; takes ~ 240 px when
 * expanded, collapses to a small badge when state is terminal.
 *
 * Auto-poll: when the local state is UPLOADED or IN_VALIDATION the
 * component re-queries `/status` every 6 s for up to 2 minutes. After
 * that the user has to press Re-verifică manually — keeps the open page
 * from hammering ANAF for hours on a stuck submission.
 */
export function AnafInvoiceCell({ invoiceId }: { invoiceId: string }): JSX.Element {
  const qc = useQueryClient();
  const [pollUntil, setPollUntil] = useState<number | null>(null);

  // 404 (no submission yet) is the resting state — treat it as "not submitted".
  const statusQ = useQuery<StatusResponse | null>({
    queryKey: ['anaf', 'status', invoiceId],
    queryFn: async () => {
      try {
        return await anafApi.status(invoiceId);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    // Refetch on the polling cadence.
    refetchInterval: (q) => {
      if (!pollUntil || Date.now() > pollUntil) return false;
      const s = q.state.data?.status;
      return s === 'UPLOADED' || s === 'IN_VALIDATION' ? 6_000 : false;
    },
  });

  const submitM = useMutation({
    mutationFn: () => anafApi.submit(invoiceId),
    onSuccess: () => {
      // Start polling for ~2 minutes to capture the OK/NOK transition.
      setPollUntil(Date.now() + 120_000);
      void qc.invalidateQueries({ queryKey: ['anaf', 'status', invoiceId] });
    },
  });

  // No useEffect needed to "stop polling" — refetchInterval already
  // returns false when the status is terminal (OK/NOK/FAILED), which
  // halts the cycle. Following LESSONS.md (2026-04-27 react-hooks
  // set-state-in-effect rule) — derive, don't sync.

  // Not submitted yet → just show the submit button.
  if (statusQ.data === null && !submitM.isPending) {
    return (
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => submitM.mutate()}
          disabled={submitM.isPending}
          title="Trimite factura la ANAF e-Factura (UBL 2.1)"
        >
          <Send size={13} className="mr-1.5" />
          Trimite la ANAF
        </Button>
      </div>
    );
  }

  if (submitM.isPending || (statusQ.data === undefined && statusQ.isLoading)) {
    return (
      <div className="text-xs text-muted-foreground">Se trimite la ANAF…</div>
    );
  }

  if (submitM.isError) {
    const msg = submitM.error instanceof Error ? submitM.error.message : 'eroare necunoscută';
    return (
      <div className="flex items-center gap-2">
        <StatusBadge tone="pink">ANAF: eșuat</StatusBadge>
        <Button size="sm" variant="ghost" onClick={() => submitM.mutate()}>Reîncearcă</Button>
        <span className="text-xs text-muted-foreground" title={msg}>{msg.slice(0, 60)}</span>
      </div>
    );
  }

  const data = statusQ.data;
  if (!data) return <></>;

  const status: AnafStatus = data.status;
  const isTerminal = status === 'OK' || status === 'NOK' || status === 'FAILED';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge tone={anafStatusTone(status)}>
        ANAF: {anafStatusLabel(status)}
      </StatusBadge>
      {data.uploadIndex && (
        <span className="font-mono text-xs text-muted-foreground" title="index_incarcare">
          #{data.uploadIndex}
        </span>
      )}
      {!isTerminal && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => qc.invalidateQueries({ queryKey: ['anaf', 'status', invoiceId] })}
          title="Re-verifică starea la ANAF"
        >
          <RefreshCw size={13} />
        </Button>
      )}
      {data.uploadIndex && (
        <button
          type="button"
          onClick={async () => {
            // Fetch with auth, then open as a blob URL — opening the
            // raw endpoint in a new tab strips the Bearer token (it
            // lives in the in-memory zustand store, not in cookies).
            const xml = await anafApi.fetchXml(invoiceId);
            const blob = new Blob([xml], { type: 'application/xml' });
            const url = URL.createObjectURL(blob);
            window.open(url, '_blank', 'noopener,noreferrer');
            // Free the URL after the browser has had time to load it.
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
          title="Descarcă XML UBL 2.1 (auditare)"
        >
          <FileDown size={12} />
          XML
        </button>
      )}
      {status === 'NOK' && data.errors && data.errors.length > 0 && (
        <span
          className="text-xs text-destructive"
          title={data.errors.join(' • ')}
        >
          {data.errors[0].slice(0, 60)}
        </span>
      )}
    </div>
  );
}
