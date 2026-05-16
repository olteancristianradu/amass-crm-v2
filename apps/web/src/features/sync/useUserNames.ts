import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { api } from '@/lib/api';

/**
 * Resolve userIds → display names via /users/lookup. Cached for 5 min
 * because user names are stable; if a coworker renames themselves, the
 * cache will simply show the old name for a few minutes (acceptable).
 *
 * Used by PresenceBadge so the "+N persoane văd această pagină" tooltip
 * surfaces real names ("Dana Rulea") instead of opaque cuids.
 *
 * Returns `Map<userId, fullName>`. Unknown ids (deleted users, race
 * conditions) get the literal "Utilizator necunoscut" fallback when
 * looked up via `nameFor()`.
 */
interface UserLookupResponse {
  data: Array<{ id: string; fullName: string }>;
}

export function useUserNames(userIds: string[]): {
  loading: boolean;
  nameFor: (userId: string) => string;
} {
  // Sort + join for a stable cache key — order-independent.
  const key = useMemo(() => [...userIds].sort().join(','), [userIds]);

  const { data, isLoading } = useQuery({
    queryKey: ['users', 'lookup', key],
    queryFn: async (): Promise<UserLookupResponse> => {
      if (userIds.length === 0) return { data: [] };
      // Comma-separated ids — backend caps at 100.
      const ids = userIds.slice(0, 100).join(',');
      return (await api.get(`/users/lookup?ids=${encodeURIComponent(ids)}`)) as UserLookupResponse;
    },
    // Names rarely change; 5 min cache is plenty for presence display.
    staleTime: 5 * 60 * 1000,
    // Don't fire on empty list — avoids a wasted GET.
    enabled: userIds.length > 0,
  });

  const lookup = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of data?.data ?? []) m.set(u.id, u.fullName);
    return m;
  }, [data]);

  return {
    loading: isLoading,
    nameFor: (userId: string) => lookup.get(userId) ?? 'Utilizator necunoscut',
  };
}
