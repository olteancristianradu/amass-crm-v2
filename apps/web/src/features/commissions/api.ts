import { api } from '@/lib/api';

export interface CommissionPlan {
  id: string;
  name: string;
  percent: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Commission {
  id: string;
  userId: string;
  planId: string;
  year: number;
  month: number;
  dealsCount: number;
  basis: string;
  amount: string;
  currency: string;
  paidAt?: string | null;
}

export const commissionsApi = {
  listPlans: () => api.get<CommissionPlan[]>('/commissions/plans'),
  createPlan: (data: unknown) => api.post<CommissionPlan>('/commissions/plans', data),
  updatePlan: (id: string, data: unknown) => api.patch<CommissionPlan>(`/commissions/plans/${id}`, data),
  deletePlan: (id: string) => api.delete<void>(`/commissions/plans/${id}`),
  compute: (data: { year: number; month: number; planId: string }) =>
    api.post<Commission[]>('/commissions/compute', data),
  list: (year?: number, month?: number) =>
    api.get<Commission[]>('/commissions', { year, month }),
  markPaid: (id: string) => api.post<Commission>(`/commissions/${id}/mark-paid`, {}),
};
