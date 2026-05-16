import { Eye } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useUserNames } from './useUserNames';

/**
 * B1-PR4 — "Someone else is viewing this page" chip.
 *
 * Renders nothing when there are no other viewers — empty UI is the
 * correct UI here; we don't want a "0 persoane" pill cluttering the page.
 *
 * Tooltip uses `useUserNames` to resolve viewer userIds to fullNames
 * via the cached /users/lookup endpoint. While the lookup is in flight
 * we show a "loading" message instead of stale cuid placeholders.
 */
export interface PresenceBadgeProps {
  viewerUserIds: string[];
  className?: string;
}

export function PresenceBadge({
  viewerUserIds,
  className,
}: PresenceBadgeProps): JSX.Element | null {
  // ORDER: hook calls must run unconditionally — early-return AFTER the hook.
  const { loading, nameFor } = useUserNames(viewerUserIds);

  if (viewerUserIds.length === 0) return null;

  const count = viewerUserIds.length;
  // Romanian noun agreement: "1 persoană vede" vs "N persoane văd".
  const label =
    count === 1
      ? '+1 persoană vede această pagină'
      : `+${count} persoane văd această pagină`;

  // Tooltip lists viewer names (cap at 5). When the lookup is mid-flight
  // we surface a friendly loading message — better than flickering raw IDs.
  const tooltipLines = loading
    ? ['Se încarcă numele...']
    : viewerUserIds.slice(0, 5).map((id) => nameFor(id));
  if (viewerUserIds.length > 5) {
    tooltipLines.push(`… și încă ${viewerUserIds.length - 5}`);
  }

  return (
    <span
      data-tour="presence-badge"
      data-testid="presence-badge"
      title={tooltipLines.join('\n')}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full bg-accent-blue/15 px-2 py-0.5 text-xs font-medium text-accent-blue',
        className,
      )}
    >
      <Eye size={12} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
