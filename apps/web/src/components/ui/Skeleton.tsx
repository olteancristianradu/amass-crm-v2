import { cn } from '@/lib/cn';

export function Skeleton({ className }: { className?: string }): JSX.Element {
  return <div className={cn('animate-pulse rounded bg-muted', className)} />;
}

export function TableSkeleton({ rows = 5, cols = 4 }: { rows?: number; cols?: number }): JSX.Element {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton(): JSX.Element {
  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <Skeleton className="h-5 w-1/3" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  );
}
