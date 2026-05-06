import { useState } from 'react';
import { Plus, RotateCcw, Settings2 } from 'lucide-react';
import { ALL_WIDGETS, WIDGET_LABELS, type CockpitFeedItem } from './api';

interface Props {
  enabled: CockpitFeedItem['widget'][];
  onToggle: (widget: CockpitFeedItem['widget']) => void;
  onReset: () => void;
}

export function CockpitWidgetPicker({ enabled, onToggle, onReset }: Props): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"
      >
        <Settings2 className="h-4 w-4" />
        Widget-uri
        <span className="ml-1 rounded-full bg-white/10 px-2 py-0.5 text-xs">
          {enabled.length}/{ALL_WIDGETS.length}
        </span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div className="absolute right-0 z-20 mt-2 w-72 rounded-xl border border-white/10 bg-slate-900/95 p-3 shadow-xl backdrop-blur-md">
            <p className="mb-2 px-1 text-xs uppercase tracking-wide text-white/50">
              Selectează widget-uri
            </p>
            <ul className="space-y-1">
              {ALL_WIDGETS.map((w) => {
                const isOn = enabled.includes(w);
                return (
                  <li key={w}>
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 transition hover:bg-white/5">
                      <span className="text-sm text-white/90">{WIDGET_LABELS[w]}</span>
                      <input
                        type="checkbox"
                        checked={isOn}
                        onChange={() => onToggle(w)}
                        className="h-4 w-4 rounded accent-cyan-500"
                      />
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => {
                  onReset();
                  setOpen(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-white/60 transition hover:text-white"
              >
                <RotateCcw className="h-3 w-3" />
                Reset
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md bg-cyan-500/20 px-3 py-1 text-xs font-medium text-cyan-200 transition hover:bg-cyan-500/30"
              >
                Gata
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Plus icon kept here so build doesn't complain about unused import
// when we later add a "+ Add widget" inline button.
export const _IconReExport = Plus;
