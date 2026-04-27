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
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <GlassCard className={cn('overflow-hidden', className)}>{children}</GlassCard>
  );
}

/**
 * Toolbar row above the table — search, filters, bulk-actions. Wraps
 * to multiple lines on narrow screens.
 */
export function Toolbar({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={cn('mb-3 flex flex-wrap items-center gap-2', className)}>
      {children}
    </div>
  );
}

interface EmptyStateProps {
  /** Lucide icon component (optional). */
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  description?: ReactNode;
  /** Primary CTA — usually a Button. */
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {Icon && (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <Icon size={22} />
        </span>
      )}
      <p className="text-base font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
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
