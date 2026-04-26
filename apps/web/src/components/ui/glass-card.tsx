import { forwardRef, type HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

/**
 * GlassCard — the primitive panel everything else stacks on top of.
 *
 * Two elevation levels:
 *   `default` → standard cards in a list/dashboard
 *   `elevated` → modals, popovers, focused detail surfaces
 *
 * Padding is intentionally NOT baked in — different layouts want
 * different rhythms. Compose with `p-4`, `p-6`, etc. inline.
 *
 *   <GlassCard className="p-6">…</GlassCard>
 *   <GlassCard elevation="elevated" className="p-8 space-y-4">…</GlassCard>
 */
export interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: 'default' | 'elevated';
  /** Show a subtle inset highlight on the top edge — gives the card "weight". */
  inset?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ elevation = 'default', className, ...rest }, ref) => (
    <div
      ref={ref}
      className={cn(
        'glass-card',
        elevation === 'elevated' && 'glass-elev',
        className,
      )}
      {...rest}
    />
  ),
);
GlassCard.displayName = 'GlassCard';

/** Soft toolbar pill — used for sidebars, top nav, segmented controls. */
export const GlassPill = forwardRef<
  HTMLButtonElement,
  HTMLAttributes<HTMLButtonElement> & { active?: boolean; type?: 'button' | 'submit' }
>(({ className, active, type = 'button', ...rest }, ref) => (
  <button
    ref={ref}
    type={type}
    data-active={active ? 'true' : undefined}
    className={cn('glass-pill', className)}
    {...rest}
  />
));
GlassPill.displayName = 'GlassPill';

/** Coloured 8px dot. Match the Tailwind colour token via `tone` prop. */
export type StatusTone = 'blue' | 'pink' | 'amber' | 'green' | 'muted';

export function StatusDot({ tone = 'muted', className }: { tone?: StatusTone; className?: string }) {
  return <span className={cn('status-dot', `status-dot--${tone}`, className)} aria-hidden="true" />;
}
