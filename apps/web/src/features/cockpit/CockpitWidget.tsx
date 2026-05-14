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
      className={`relative rounded-2xl border bg-card text-card-foreground shadow-sm p-5 transition-all duration-200 ease-out ${
        isDragging ? 'scale-[0.98] border-primary opacity-60 shadow-2xl' : 'border-border'
      } ${isDropTarget ? 'border-primary ring-2 ring-primary/40 shadow-lg' : ''}`}
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
            className={`mt-1 cursor-grab rounded-md p-1 transition-all duration-150 hover:bg-secondary active:cursor-grabbing active:scale-95 ${
              grabbed ? 'bg-secondary text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-semibold text-foreground">{WIDGET_LABELS[widget]}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{WIDGET_DESCRIPTIONS[widget]}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={isFirst}
            aria-label="Mută widget mai sus"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-30"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={isLast}
            aria-label="Mută widget mai jos"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-30"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Ascunde widget"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
          Nimic de făcut aici. Bună treabă.
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {filtered.map((item) => (
            <li key={item.id}>
              <Link
                to={item.href}
                className="group flex items-center justify-between gap-3 rounded-md px-2 py-3 transition hover:bg-secondary/60"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-foreground">
                    {item.title}
                  </p>
                  {item.subtitle && (
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">{item.subtitle}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      item.score >= 80
                        ? 'bg-destructive/15 text-destructive'
                        : item.score >= 60
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'bg-secondary text-secondary-foreground'
                    }`}
                  >
                    {item.score}
                  </span>
                  <ArrowUpRight className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
