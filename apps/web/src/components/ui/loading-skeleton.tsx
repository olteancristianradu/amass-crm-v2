import { cn } from '@/lib/cn';

/**
 * Reusable loading skeleton primitives for list pages.
 *
 * Usage:
 *   {isLoading && <TableRowSkeleton rows={6} cols={4} />}
 *   {isLoading && <CardGridSkeleton cards={6} />}
 *
 * Designed to match the glass-morphism look — subtle pulse, no
 * shimmer animation (motion-reduced friendly).
 */

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps): JSX.Element {
  return (
    <div
      role="status"
      aria-label="Se încarcă"
      className={cn('animate-pulse rounded-md bg-white/[0.04]', className)}
    />
  );
}

interface TableRowSkeletonProps {
  rows?: number;
  cols?: number;
}

export function TableRowSkeleton({ rows = 5, cols = 4 }: TableRowSkeletonProps): JSX.Element {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-10', c === 0 ? 'w-10' : 'flex-1')} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface CardGridSkeletonProps {
  cards?: number;
}

export function CardGridSkeleton({ cards = 6 }: CardGridSkeletonProps): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: cards }).map((_, i) => (
        <Skeleton key={i} className="h-32" />
      ))}
    </div>
  );
}

interface ListSkeletonProps {
  rows?: number;
}

export function ListSkeleton({ rows = 5 }: ListSkeletonProps): JSX.Element {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-16" />
      ))}
    </div>
  );
}
