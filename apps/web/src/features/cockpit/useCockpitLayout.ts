import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ALL_WIDGETS, cockpitApi, type CockpitFeedItem } from './api';

const STORAGE_KEY = 'amass:cockpit-layout-v1';

export interface CockpitLayout {
  /** Ordered list of widget ids the user wants to see, top to bottom. */
  enabled: CockpitFeedItem['widget'][];
}

const DEFAULT_LAYOUT: CockpitLayout = {
  enabled: ['deals-in-danger', 'reminders-due-today', 'tasks-overdue'],
};

function sanitize(widgets: string[]): CockpitFeedItem['widget'][] {
  return widgets.filter((w): w is CockpitFeedItem['widget'] =>
    ALL_WIDGETS.includes(w as CockpitFeedItem['widget']),
  );
}

function readLocal(): CockpitLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<CockpitLayout>;
    if (!Array.isArray(parsed.enabled)) return DEFAULT_LAYOUT;
    const enabled = sanitize(parsed.enabled);
    return { enabled: enabled.length > 0 ? enabled : DEFAULT_LAYOUT.enabled };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function writeLocal(layout: CockpitLayout): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    /* quota exceeded — silent */
  }
}

/**
 * Layout source-of-truth = TanStack Query cache for ['cockpit-layout'].
 * localStorage is a read-fallback so the page renders something while
 * the API loads, plus graceful-degrade if the API is unreachable.
 *
 * Mutations write through:
 *  1. `qc.setQueryData(['cockpit-layout'], …)` — instant optimistic update
 *  2. `cockpitApi.saveLayout()` mutation — persist server-side
 *  3. localStorage on success — fallback for next page load
 */
export function useCockpitLayout() {
  const qc = useQueryClient();

  const remote = useQuery({
    queryKey: ['cockpit-layout'],
    queryFn: cockpitApi.getLayout,
    retry: 1,
    initialData: { widgets: readLocal().enabled as string[] },
  });

  const save = useMutation({
    mutationFn: (widgets: string[]) => cockpitApi.saveLayout(widgets),
    onSuccess: (data) => {
      qc.setQueryData(['cockpit-layout'], data);
      writeLocal({ enabled: sanitize(data.widgets) });
    },
  });

  // Derive the visible layout from the cached query data — no setState
  // in an effect, no double source of truth.
  const layout: CockpitLayout = useMemo(() => {
    const enabled = sanitize(remote.data?.widgets ?? DEFAULT_LAYOUT.enabled);
    return { enabled: enabled.length > 0 ? enabled : DEFAULT_LAYOUT.enabled };
  }, [remote.data]);

  const persist = (next: CockpitLayout) => {
    qc.setQueryData(['cockpit-layout'], { widgets: next.enabled });
    writeLocal(next);
    save.mutate(next.enabled);
  };

  return {
    layout,
    isLoading: remote.isLoading,
    toggle: (widget: CockpitFeedItem['widget']) => {
      const enabled = layout.enabled.includes(widget)
        ? layout.enabled.filter((w) => w !== widget)
        : [...layout.enabled, widget];
      persist({ enabled });
    },
    moveUp: (widget: CockpitFeedItem['widget']) => {
      const idx = layout.enabled.indexOf(widget);
      if (idx <= 0) return;
      const next = [...layout.enabled];
      [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
      persist({ enabled: next });
    },
    moveDown: (widget: CockpitFeedItem['widget']) => {
      const idx = layout.enabled.indexOf(widget);
      if (idx === -1 || idx >= layout.enabled.length - 1) return;
      const next = [...layout.enabled];
      [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
      persist({ enabled: next });
    },
    /** Reorder by replacing the array — used by drag-drop. */
    setEnabled: (enabled: CockpitFeedItem['widget'][]) => persist({ enabled }),
    reset: () => persist(DEFAULT_LAYOUT),
  };
}
