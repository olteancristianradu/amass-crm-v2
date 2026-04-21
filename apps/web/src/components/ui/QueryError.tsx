import { Card } from './card';

/**
 * M-3 — uniform error banner for TanStack Query failures.
 *
 * Drop next to `isLoading` in every list route:
 *   {isLoading && <TableSkeleton />}
 *   <QueryError isError={isError} error={error} />
 *
 * Renders nothing when not in an error state, so it is safe to leave
 * unconditionally mounted.
 */
export function QueryError({
  isError,
  error,
  label = 'Nu am putut încărca datele.',
}: {
  isError: boolean;
  error?: unknown;
  label?: string;
}) {
  if (!isError) return null;
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : undefined;
  return (
    <Card className="border-destructive bg-destructive/5 p-4 text-sm text-destructive">
      <p className="font-medium">{label}</p>
      {detail && <p className="mt-1 opacity-80">{detail}</p>}
      <p className="mt-2 text-xs opacity-70">
        Reîncarcă pagina sau încearcă din nou în câteva secunde.
      </p>
    </Card>
  );
}
