import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, ChevronDown, Plus, Save, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SavedViewResource } from '@amass/shared';
import { savedViewsApi, type SavedView } from '@/features/saved-views/api';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';

/**
 * Saved-view dropdown for list pages. Drop in on any list page that has a
 * filters object and want users to bookmark+restore them.
 *
 * Contract:
 *   - `currentFilters` is whatever opaque blob the page's URL state +
 *     in-memory filters represent. The dropdown writes it through
 *     unchanged when the user saves.
 *   - `onApply` is called when the user picks a view; the page is in
 *     charge of mapping `view.filters` back into its URL search params.
 *
 * No optimistic UI — react-query invalidates after each mutation, and
 * the round-trip is fast enough that the user doesn't feel it.
 */
export function SavedViewsDropdown({
  resource,
  currentFilters,
  onApply,
}: {
  resource: SavedViewResource;
  currentFilters: Record<string, unknown>;
  onApply: (filters: Record<string, unknown>) => void;
}): JSX.Element {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-outside to close.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent): void {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const { data: views = [], isLoading } = useQuery({
    queryKey: ['saved-views', resource],
    queryFn: () => savedViewsApi.list(resource),
  });

  const createMut = useMutation({
    mutationFn: (input: { name: string; filters: Record<string, unknown> }) =>
      savedViewsApi.create({ resource, name: input.name, filters: input.filters }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-views', resource] }),
  });

  const removeMut = useMutation({
    mutationFn: (id: string) => savedViewsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['saved-views', resource] }),
  });

  function handleSaveCurrent(): void {
    const name = window.prompt('Nume pentru această vizualizare?');
    if (!name?.trim()) return;
    createMut.mutate(
      { name: name.trim(), filters: currentFilters },
      {
        onError: (err) => {
          alert(err instanceof ApiError ? err.message : 'Eroare la salvare.');
        },
      },
    );
  }

  function handleApply(view: SavedView): void {
    onApply(view.filters);
    setOpen(false);
  }

  function handleDelete(view: SavedView, e: React.MouseEvent): void {
    e.stopPropagation();
    if (!window.confirm(`Ștergi vizualizarea "${view.name}"?`)) return;
    removeMut.mutate(view.id);
  }

  return (
    <div className="relative" ref={wrapRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Bookmark size={14} className="mr-1.5" />
        Vizualizări
        <ChevronDown size={14} className="ml-1" />
      </Button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-md border border-border/70 bg-popover shadow-glass"
        >
          <button
            type="button"
            onClick={handleSaveCurrent}
            disabled={createMut.isPending}
            className="flex w-full items-center gap-2 border-b border-border/60 bg-secondary/40 px-3 py-2 text-left text-sm font-medium hover:bg-secondary/70"
          >
            <Save size={14} />
            {createMut.isPending ? 'Se salvează…' : 'Salvează vizualizarea curentă'}
          </button>
          {isLoading ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">Se încarcă…</p>
          ) : views.length === 0 ? (
            <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
              <Plus size={12} /> Nu ai încă vizualizări salvate.
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto">
              {views.map((view) => (
                <li key={view.id}>
                  <button
                    type="button"
                    onClick={() => handleApply(view)}
                    className="group flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-secondary/40"
                  >
                    <span className="truncate">{view.name}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`Șterge ${view.name}`}
                      onClick={(e) => handleDelete(view, e)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          handleDelete(view, e as unknown as React.MouseEvent);
                        }
                      }}
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground opacity-0 transition group-hover:opacity-100 hover:bg-destructive/15 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Trash2 size={14} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
