import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import type { Tag, TagEntityType } from '@/lib/types';
import { tagsApi } from '@/features/tags/api';
import { TagBadge } from './TagBadge';

interface TagInputProps {
  entityType: TagEntityType;
  entityId: string;
  /** Tags currently on this entity (optimistic source of truth). */
  value: Tag[];
  onChange?: (tags: Tag[]) => void;
  readOnly?: boolean;
}

export function TagInput({ entityType, entityId, value, onChange, readOnly = false }: TagInputProps): JSX.Element {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Tenant-wide tag list for autocomplete
  const { data: allTags = [] } = useQuery({
    queryKey: ['tags', entityType],
    queryFn: () => tagsApi.list({ entityType }),
    staleTime: 30_000,
  });

  const createTagMut = useMutation({
    mutationFn: (name: string) => tagsApi.create({ name }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tags'] }),
  });

  const assignMut = useMutation({
    mutationFn: (tag: Tag) => tagsApi.assign(tag.id, { entityType, entityId }),
    onSuccess: (_data, tag) => {
      onChange?.([...value, tag]);
      qc.invalidateQueries({ queryKey: ['tags', entityType, entityId] });
    },
  });

  const unassignMut = useMutation({
    mutationFn: (tagId: string) => tagsApi.unassign(tagId, entityId),
    onSuccess: (_data, tagId) => {
      onChange?.(value.filter((t) => t.id !== tagId));
      qc.invalidateQueries({ queryKey: ['tags', entityType, entityId] });
    },
  });

  const assignedIds = new Set(value.map((t) => t.id));
  const filtered = allTags
    .filter((t) => !assignedIds.has(t.id))
    .filter((t) => t.name.toLowerCase().includes(search.toLowerCase()));
  const canCreate = search.trim().length > 0 && !allTags.some((t) => t.name.toLowerCase() === search.trim().toLowerCase());

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent): void {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function handleSelect(tag: Tag): Promise<void> {
    setSearch('');
    setOpen(false);
    await assignMut.mutateAsync(tag);
  }

  async function handleCreate(): Promise<void> {
    const name = search.trim();
    if (!name) return;
    setSearch('');
    setOpen(false);
    const tag = await createTagMut.mutateAsync(name);
    await assignMut.mutateAsync(tag);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((tag) => (
        <TagBadge
          key={tag.id}
          tag={tag}
          onRemove={readOnly ? undefined : () => unassignMut.mutate(tag.id)}
        />
      ))}
      {!readOnly && (
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 0); }}
            className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-muted-foreground/40 px-2 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors"
          >
            <Plus className="h-3 w-3" />
            Etichetă
          </button>
          {open && (
            <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-lg border bg-popover shadow-lg">
              <div className="p-2 border-b">
                <input
                  ref={inputRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); void handleCreate(); }
                    if (e.key === 'Escape') { setOpen(false); setSearch(''); }
                  }}
                  placeholder="Caută sau creează..."
                  className="w-full rounded-md bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
              </div>
              <div className="max-h-48 overflow-y-auto p-1">
                {filtered.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => void handleSelect(tag)}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2"
                  >
                    <span className="h-2 w-2 rounded-full bg-primary/40" style={tag.color ? { backgroundColor: tag.color } : undefined} />
                    {tag.name}
                  </button>
                ))}
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => void handleCreate()}
                    className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent flex items-center gap-2 text-primary"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Creează &ldquo;{search.trim()}&rdquo;
                  </button>
                )}
                {filtered.length === 0 && !canCreate && (
                  <p className="px-2 py-3 text-center text-xs text-muted-foreground">Nicio etichetă găsită</p>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
