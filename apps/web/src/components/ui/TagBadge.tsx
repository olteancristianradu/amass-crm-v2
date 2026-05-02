import { X } from 'lucide-react';
import type { Tag } from '@/lib/types';

// Default palette for tags without an explicit color
const DEFAULT_COLORS = [
  'bg-blue-100 text-blue-800',
  'bg-green-100 text-green-800',
  'bg-amber-100 text-amber-800',
  'bg-purple-100 text-purple-800',
  'bg-rose-100 text-rose-800',
  'bg-cyan-100 text-cyan-800',
  'bg-orange-100 text-orange-800',
  'bg-teal-100 text-teal-800',
];

function colorClass(tag: Tag): string {
  if (tag.color) return `text-white`;
  const idx = tag.name.charCodeAt(0) % DEFAULT_COLORS.length;
  return DEFAULT_COLORS[idx] ?? DEFAULT_COLORS[0];
}

interface TagBadgeProps {
  tag: Tag;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}

export function TagBadge({ tag, onRemove, size = 'sm' }: TagBadgeProps): JSX.Element {
  const cls = colorClass(tag);
  const padding = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-medium ${padding} ${cls}`}
      style={tag.color ? { backgroundColor: tag.color } : undefined}
    >
      {tag.name}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="hover:opacity-70 -mr-0.5"
          aria-label={`Elimină eticheta ${tag.name}`}
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}
