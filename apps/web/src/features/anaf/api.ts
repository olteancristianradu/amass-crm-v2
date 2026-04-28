import { api } from '@/lib/api';

/**
 * ANAF e-Factura submission lifecycle (matches AnafSubmissionStatus enum
 * in apps/api/prisma/schema.prisma):
 *
 *   PENDING        — placeholder before first submit
 *   UPLOADED       — UBL XML accepted by ANAF, index_incarcare returned
 *   IN_VALIDATION  — ANAF is processing (poll stareMesaj for completion)
 *   OK             — accepted; id_descarcare returned (download receipt)
 *   ERROR          — ANAF rejected with errors[] (see lastResponse)
 *   FAILED         — local network / OAuth / circuit-breaker failure
 */
export type AnafStatus = 'PENDING' | 'UPLOADED' | 'IN_VALIDATION' | 'OK' | 'NOK' | 'FAILED';

export interface AnafSubmission {
  id: string;
  invoiceId: string;
  status: AnafStatus;
  uploadIndex: string | null;
  downloadIndex: string | null;
  errors: string[] | null;
  submittedAt: string | null;
  validatedAt: string | null;
  lastCheckedAt: string | null;
  xmlContent: string | null;
}

export interface SubmitResponse {
  uploadIndex: string;
}

export interface StatusResponse {
  status: AnafStatus;
  uploadIndex: string | null;
  downloadIndex: string | null;
  errors: string[] | null;
  validatedAt: string | null;
}

export const anafApi = {
  /** POST /anaf/invoices/:id/submit — generate UBL + upload to SPV. */
  submit: (invoiceId: string) =>
    api.post<SubmitResponse>(`/anaf/invoices/${invoiceId}/submit`, {}),

  /** GET /anaf/invoices/:id/status — re-check ANAF state via stareMesaj. */
  status: (invoiceId: string) =>
    api.get<StatusResponse>(`/anaf/invoices/${invoiceId}/status`),

  /**
   * GET /anaf/invoices/:id/xml — raw UBL 2.1 XML (Content-Type: application/xml).
   * Used for the "Descarcă XML" button so the accountant can audit it.
   */
  xmlUrl: (invoiceId: string) => `/api/v1/anaf/invoices/${invoiceId}/xml`,
};

/**
 * Map an ANAF status to a StatusBadge tone using the design-system v2
 * vocabulary defined in `components/ui/page-header.tsx`:
 * neutral / blue / amber / pink / green. Kept here so the dashboard,
 * the invoice card, and a future invoice-detail page render the badge
 * identically.
 */
export function anafStatusTone(s: AnafStatus): 'neutral' | 'blue' | 'amber' | 'pink' | 'green' {
  switch (s) {
    case 'OK':
      return 'green';
    case 'UPLOADED':
    case 'IN_VALIDATION':
      return 'blue';
    case 'NOK':
    case 'FAILED':
      return 'pink';
    case 'PENDING':
    default:
      return 'neutral';
  }
}

/**
 * Romanian display label for the ANAF status. The audience here is the
 * accountant, so we keep technical terms recognisable from ANAF's own
 * documentation (UPLOADED → "Trimisă", OK → "Validată").
 */
export function anafStatusLabel(s: AnafStatus): string {
  switch (s) {
    case 'PENDING':       return 'Neprezentată';
    case 'UPLOADED':      return 'Trimisă';
    case 'IN_VALIDATION': return 'În validare';
    case 'OK':            return 'Validată';
    case 'NOK':           return 'Respinsă';
    case 'FAILED':        return 'Eroare locală';
  }
}
