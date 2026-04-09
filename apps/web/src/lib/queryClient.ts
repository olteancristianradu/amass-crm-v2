import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

/**
 * Single TanStack Query client for the whole app. Defaults:
 *  - 30s stale time (most screens don't need sub-second freshness)
 *  - no retry on 401/403/404 — those are user-visible errors, retrying
 *    just delays the error UI.
 *  - 1 retry on transient network errors.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError) {
          if ([400, 401, 403, 404].includes(error.status)) return false;
        }
        return failureCount < 1;
      },
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: false,
    },
  },
});
