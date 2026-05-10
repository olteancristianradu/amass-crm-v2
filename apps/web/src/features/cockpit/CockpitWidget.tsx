import { useState, type DragEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, ChevronDown, ChevronUp, GripVertical, X } from 'lucide-react';
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
  /** Drag-drop handlers from the parent — manage reorder via setEnabled. */
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  isDragging: boolean;
  isDropTarget: boolean;
}

export function CockpitWidget({
  widget,
  items,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  isDragging,
  isDropTarget,
}: Props): JSX.Element {
  const [grabbed, setGrabbed] = useState(false);
  const filtered = items.filter((i) => i.widget === widget).slice(0, 6);

  return (
    <section
      draggable={grabbed}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={() => { onDragEnd(); setGrabbed(false); }}
      className={`relative rounded-2xl border bg-white/[0.02] p-5 backdrop-blur-md transition-all duration-200 ease-out ${
        isDragging ? 'scale-[0.98] border-cyan-400/50 opacity-60 shadow-2xl' : 'border-white/10'
      } ${isDropTarget ? 'border-cyan-400/60 ring-2 ring-cyan-400/40 shadow-[0_0_24px_rgba(34,211,238,0.15)]' : ''}`}
      data-widget={widget}
    >
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <button
            type="button"
            onMouseDown={() => setGrabbed(true)}
            onMouseUp={() => setGrabbed(false)}
            onMouseLeave={() => setGrabbed(false)}
            aria-label="Trage pentru reordonare"
            aria-grabbed={grabbed}
            title="Apasă și trage pentru reordonare"
            className={`mt-1 cursor-grab rounded-md p-1 transition-all duration-150 hover:bg-white/10 active:cursor-grabbing active:scale-95 ${
              grabbed ? 'bg-white/10 text-cyan-300' : 'text-white/40 hover:text-white'
            }`}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-white">{WIDGET_LABELS[widget]}</h2>
            <p className="mt-0.5 text-sm text-white/60">{WIDGET_DESCRIPTIONS[widget]}</p>
          </div>
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
