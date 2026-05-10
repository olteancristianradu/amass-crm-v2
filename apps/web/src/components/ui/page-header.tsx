import { type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { GlassCard } from './glass-card';

/**
 * Page-level primitives for list/detail pages built on the v2 design
 * system. Each primitive solves one rhythm problem so individual routes
 * can stay short and consistent.
 *
 * Composition pattern (companies/contacts/deals/leads/quotes/invoices):
 *
 *   <PageHeader title="Companii" subtitle="…" actions={…}/>
 *   <Toolbar>
 *     <SearchInput … />
 *     <SegmentedFilter … />
 *     <BulkActionsBar selected={…} actions={…}/>
 *   </Toolbar>
 *   <ListSurface>
 *     <table>…</table>          // rows
 *     <EmptyState … />          // when empty
 *   </ListSurface>
 */

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  /** Buttons / pills aligned to the right of the title. */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps): JSX.Element {
  return (
    <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

/**
 * Glass surface that contains a list (table, kanban column-set, etc.).
 * Use directly when you want the table to inherit the surface styling
 * via overflow-hidden + rounded.
 */
export function ListSurface({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <GlassCard className={cn('overflow-hidden', className)} {...rest}>
      {children}
    </GlassCard>
  );
}

/**
 * Toolbar row above the table — search, filters, bulk-actions. Wraps
 * to multiple lines on narrow screens.
 */
export function Toolbar({
  className,
  children,
  ...rest
}: {
  className?: string;
  children: ReactNode;
} & React.HTMLAttributes<HTMLDivElement>): JSX.Element {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-2', className)} {...rest}>
      {children}
    </div>
  );
}

interface EmptyStateProps {
  /** Lucide icon component (optional). Mutually exclusive with `illustration`. */
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  /**
   * Inline-SVG illustration variant. When set, replaces the small icon
   * with a larger illustrated card. Variants are decorative only — keep
   * page semantics in `title`/`description` for screen readers.
   */
  illustration?: 'empty-list' | 'no-results' | 'error';
  title: string;
  description?: ReactNode;
  /** Primary CTA — usually a Button. */
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon,
  illustration,
  title,
  description,
  action,
}: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {illustration ? (
        <EmptyStateIllustration variant={illustration} />
      ) : (
        Icon && (
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
            <Icon size={22} />
          </span>
        )
      )}
      <p className="text-base font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// Decorative-only inline SVGs. aria-hidden + role-less because the
// title/description carry the meaning for screen readers.
function EmptyStateIllustration({
  variant,
}: {
  variant: NonNullable<EmptyStateProps['illustration']>;
}): JSX.Element {
  return (
    <div className="mb-5 text-muted-foreground" aria-hidden="true">
      {variant === 'empty-list' && (
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
          <rect x="20" y="28" width="80" height="64" rx="6" stroke="currentColor" strokeWidth="2" opacity="0.4" />
          <line x1="32" y1="44" x2="76" y2="44" stroke="currentColor" strokeWidth="2" opacity="0.5" strokeLinecap="round" />
          <line x1="32" y1="58" x2="88" y2="58" stroke="currentColor" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
          <line x1="32" y1="72" x2="68" y2="72" stroke="currentColor" strokeWidth="2" opacity="0.3" strokeLinecap="round" />
          <circle cx="92" cy="86" r="14" fill="currentColor" opacity="0.08" />
          <path d="M92 80v12M86 86h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
        </svg>
      )}
      {variant === 'no-results' && (
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
          <circle cx="52" cy="52" r="26" stroke="currentColor" strokeWidth="2.5" opacity="0.5" />
          <line x1="72" y1="72" x2="92" y2="92" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
          <path d="M44 52h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
        </svg>
      )}
      {variant === 'error' && (
        <svg width="120" height="120" viewBox="0 0 120 120" fill="none">
          <path d="M60 22L100 90H20L60 22z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" opacity="0.5" />
          <line x1="60" y1="50" x2="60" y2="68" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          <circle cx="60" cy="78" r="2" fill="currentColor" />
        </svg>
      )}
    </div>
  );
}

/**
 * Coloured status badge with label. Distinct from StatusDot (which is
 * just an 8px circle) — this one is a full pill with text. Use for
 * resource statuses like LEAD/PROSPECT/ACTIVE/INACTIVE, OPEN/WON/LOST,
 * DRAFT/ISSUED/PAID, etc.
 */
export type StatusBadgeTone =
  | 'neutral' // grey
  | 'blue'    // info / in progress
  | 'amber'   // pending / warning
  | 'pink'    // blocked / lost
  | 'green';  // success / done

const TONE_CLASSES: Record<StatusBadgeTone, string> = {
  neutral: 'bg-secondary text-secondary-foreground',
  blue:    'bg-accent-blue/15  text-accent-blue',
  amber:   'bg-accent-amber/15 text-accent-amber',
  pink:    'bg-accent-pink/15  text-accent-pink',
  green:   'bg-accent-green/15 text-accent-green',
};

export function StatusBadge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: StatusBadgeTone;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/**
 * Sticky bulk-actions bar — appears under the toolbar when the user
 * has selected one or more rows. Provides a primary destructive action
 * + a "deselect" button.
 */
export function BulkActionsBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  /** Action buttons (Button[] typically). */
  children: ReactNode;
}): JSX.Element | null {
  if (count <= 0) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/[0.03] px-3 py-2">
      <div className="flex items-center gap-3 text-sm">
        <span className="font-medium">{count} selectat{count === 1 ? '' : 'e'}</span>
        <button
          type="button"
          onClick={onClear}
          className="text-xs text-muted-foreground underline-offset-4 hover:underline"
        >
          deselectează
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
