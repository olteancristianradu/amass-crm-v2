import { useEffect, useState } from 'react';
import { ALL_WIDGETS, type CockpitFeedItem } from './api';

const STORAGE_KEY = 'amass:cockpit-layout-v1';

export interface CockpitLayout {
  /** Ordered list of widget ids the user wants to see, top to bottom. */
  enabled: CockpitFeedItem['widget'][];
}

const DEFAULT_LAYOUT: CockpitLayout = {
  enabled: ['deals-in-danger', 'reminders-due-today', 'tasks-overdue'],
};

function readLayout(): CockpitLayout {
  if (typeof window === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(raw) as Partial<CockpitLayout>;
    if (!Array.isArray(parsed.enabled)) return DEFAULT_LAYOUT;
    // Filter to known widgets so a stale localStorage value can't crash
    // the page if we rename a widget id later.
    const enabled = parsed.enabled.filter((w): w is CockpitFeedItem['widget'] =>
      ALL_WIDGETS.includes(w as CockpitFeedItem['widget']),
    );
    return { enabled: enabled.length > 0 ? enabled : DEFAULT_LAYOUT.enabled };
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function useCockpitLayout() {
  const [layout, setLayout] = useState<CockpitLayout>(readLayout);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* quota exceeded — silent fail */
    }
  }, [layout]);

  return {
    layout,
    toggle: (widget: CockpitFeedItem['widget']) =>
      setLayout((cur) => ({
        enabled: cur.enabled.includes(widget)
          ? cur.enabled.filter((w) => w !== widget)
          : [...cur.enabled, widget],
      })),
    moveUp: (widget: CockpitFeedItem['widget']) =>
      setLayout((cur) => {
        const idx = cur.enabled.indexOf(widget);
        if (idx <= 0) return cur;
        const next = [...cur.enabled];
        [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
        return { enabled: next };
      }),
    moveDown: (widget: CockpitFeedItem['widget']) =>
      setLayout((cur) => {
        const idx = cur.enabled.indexOf(widget);
        if (idx === -1 || idx >= cur.enabled.length - 1) return cur;
        const next = [...cur.enabled];
        [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
        return { enabled: next };
      }),
    reset: () => setLayout(DEFAULT_LAYOUT),
  };
}
