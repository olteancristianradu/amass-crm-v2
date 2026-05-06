import { Link } from '@tanstack/react-router';
import { ArrowUpRight, ChevronDown, ChevronUp, X } from 'lucide-react';
import {
  WIDGET_DESCRIPTIONS,
  WIDGET_LABELS,
  type CockpitFeedItem,
} from './api';

interface Props {
  widget: CockpitFeedItem['widget'];
  items: CockpitFeedItem[];
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

export function CockpitWidget({
  widget,
  items,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
}: Props): JSX.Element {
  const filtered = items.filter((i) => i.widget === widget).slice(0, 6);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-md">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{WIDGET_LABELS[widget]}</h2>
          <p className="mt-0.5 text-sm text-white/60">{WIDGET_DESCRIPTIONS[widget]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label="Mută widget mai sus"
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label="Mută widget mai jos"
            className="rounded-md p-1.5 text-white/50 transition hover:bg-white/5 hover:text-white disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Ascunde widget"
            className="rounded-md p-1.5 text-white/50 transition hover:bg-red-500/10 hover:text-red-400"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-white/50">
          Nimic de făcut aici. Bună treabă.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {filtered.map((item) => (
            <li key={item.id}>
              <Link
                to={item.href}
                className="group flex items-center justify-between gap-3 px-1 py-3 transition hover:bg-white/[0.04]"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-white group-hover:text-white">
                    {item.title}
                  </p>
                  {item.subtitle && (
                    <p className="mt-0.5 truncate text-sm text-white/50">{item.subtitle}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      item.score >= 80
                        ? 'bg-red-500/10 text-red-300'
                        : item.score >= 60
                          ? 'bg-amber-500/10 text-amber-300'
                          : 'bg-white/5 text-white/60'
                    }`}
                  >
                    {item.score}
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-white/30 transition group-hover:text-white/70" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
