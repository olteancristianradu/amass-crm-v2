import { api } from '@/lib/api';
import type { Pipeline } from '@/lib/types';

export const pipelinesApi = {
  list: () => api.get<Pipeline[]>('/pipelines'),
  findOne: (id: string) => api.get<Pipeline>(`/pipelines/${id}`),
};
