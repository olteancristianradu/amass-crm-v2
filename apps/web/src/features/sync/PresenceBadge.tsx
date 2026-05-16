import { Eye } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * B1-PR4 — "Someone else is viewing this page" chip.
 *
 * Renders nothing when there are no other viewers — empty UI is the
 * correct UI here; we don't want a "0 persoane" pill cluttering the page.
 *
 * Hover surface: the chip's `title` attribute carries the (truncated)
 * list of viewer userIds. Full name resolution lives in a future PR
 * (B2: presence avatars); for now the userId is enough to confirm the
 * indicator is real and not a phantom.
 */
export interface PresenceBadgeProps {
  viewerUserIds: string[];
  className?: string;
}

export function PresenceBadge({
  viewerUserIds,
  className,
}: PresenceBadgeProps): JSX.Element | null {
  if (viewerUserIds.length === 0) return null;

  const count = viewerUserIds.length;
  // Romanian noun agreement: "1 persoană vede" vs "N persoane văd".
  const label =
    count === 1
      ? '+1 persoană vede această pagină'
      : `+${count} persoane văd această pagină`;

  // Tooltip lists viewer userIds (cap at 5 so a flash mob doesn't blow
  // out the title attribute). Future PR will swap to real names.
  const tooltipLines = viewerUserIds.slice(0, 5).map((id) => `User ${id}`);
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
