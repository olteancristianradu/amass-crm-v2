import { api } from '@/lib/api';

interface TourProgressResponse {
  completedTours: string[];
}

export const toursApi = {
  /** All tour IDs the current user has completed or dismissed. */
  listCompleted: () => api.get<TourProgressResponse>('/tour-progress/completed'),

  /** Mark a tour as completed (called when user finishes or skips a tour). */
  markCompleted: (tourId: string) => api.post<TourProgressResponse>(`/tour-progress/${tourId}/complete`),

  /** Re-arm a tour so it auto-launches again on next page visit. */
  markIncomplete: (tourId: string) =>
    fetch(`/api/v1/tour-progress/${tourId}/complete`, {
      method: 'DELETE',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }).then((r) => r.json() as Promise<TourProgressResponse>),
};
