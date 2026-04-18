import { api } from '@/lib/api';
import type { CursorPage } from '@/lib/types';

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
export type ApprovalDecision = 'APPROVED' | 'REJECTED';

export interface ApprovalRequest {
  id: string;
  tenantId: string;
  quoteId: string;
  quoteNumber: string;
  quoteTotal: string;
  currency: string;
  requestedById: string;
  requestedAt: string;
  status: ApprovalStatus;
  decidedById?: string | null;
  decidedAt?: string | null;
  comment?: string | null;
}

export interface DecideApprovalDto {
  decision: ApprovalDecision;
  comment?: string;
}

export const approvalsApi = {
  listRequests: (status?: ApprovalStatus, cursor?: string, limit = 50) =>
    api.get<CursorPage<ApprovalRequest>>('/approvals/requests', {
      status,
      cursor,
      limit,
    }),
  decide: (id: string, dto: DecideApprovalDto) =>
    api.post<ApprovalRequest>(`/approvals/requests/${id}/decide`, dto),
};
