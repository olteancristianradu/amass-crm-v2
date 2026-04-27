import { type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { GlassCard } from './glass-card';
import { cn } from '@/lib/cn';

/**
 * Detail-page layout primitive used across resources (Company, Contact,
 * Client, Deal, Lead, Quote, Invoice, Project). Two-column on lg+:
 *
 *   ┌────────────────┬──────────────────────────────────┐
 *   │  Sidebar (lg)  │   Main column                    │
 *   │  Field stack   │   Tabs / sections / CallCards    │
 *   │  Status/meta   │   (most space)                   │
 *   └────────────────┴──────────────────────────────────┘
 *
 * Stacks vertically on mobile (sidebar above main).
 *
 * Use:
 *   <DetailLayout
 *     title="ACME SRL"
 *     subtitle="Software · București"
 *     backHref="/app/companies"
 *     backLabel="Companii"
 *     actions={<Button>Edit</Button>}
 *     sidebar={<DetailFields>…</DetailFields>}
 *   >
 *     <Tabs>…</Tabs>
 *   </DetailLayout>
 */
export interface DetailLayoutProps {
  title: ReactNode;
  subtitle?: ReactNode;
  backHref?: string;
  backLabel?: string;
  actions?: ReactNode;
  sidebar?: ReactNode;
  children: ReactNode;
}

export function DetailLayout({
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
  sidebar,
  children,
}: DetailLayoutProps): JSX.Element {
  return (
    <div>
      <header className="mb-5 space-y-3">
        {backHref && (
          <Link
            to={backHref}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ChevronLeft size={12} />
            {backLabel ?? 'Înapoi'}
          </Link>
        )}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {subtitle && (
              <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      </header>

      <div
        className={cn(
          'grid gap-4',
          sidebar ? 'lg:grid-cols-[280px_1fr]' : '',
        )}
      >
        {sidebar && <aside className="space-y-4">{sidebar}</aside>}
        <main className="min-w-0 space-y-4">{children}</main>
      </div>
    </div>
  );
}

/**
 * Vertical stack of label/value pairs inside a GlassCard. Use one or
 * more groups in the sidebar.
 */
export function DetailFields({
  title,
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}): JSX.Element {
  return (
    <GlassCard className="p-5">
      {title && (
        <h3 className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {title}
        </h3>
      )}
      <dl className="space-y-2 text-sm">{children}</dl>
    </GlassCard>
  );
}

export function DetailField({
  label,
  value,
  copyable,
}: {
  label: ReactNode;
  value?: ReactNode;
  /** Render a font-mono value (CUI, IDs, phone) for tabular alignment. */
  copyable?: boolean;
}): JSX.Element {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'text-right',
          copyable ? 'font-mono text-xs tabular-nums' : 'font-medium',
          !value && 'text-muted-foreground',
        )}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

/**
 * Tab pills using the v2 design system. Drop-in replacement for the
 * shadcn Tabs trigger row when a route wants the new look without
 * pulling in @radix-ui/react-tabs (which the current shadcn Tabs uses).
 *
 * Controlled via `value` + `onChange`, render content yourself based on
 * the active tab — keeps the API tiny and avoids portal headaches.
 */
export interface TabBarProps<T extends string> {
  tabs: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (next: T) => void;
}

export function TabBar<T extends string>({ tabs, value, onChange }: TabBarProps<T>): JSX.Element {
  return (
    <div className="-mx-1 flex flex-wrap items-center gap-1 overflow-x-auto pb-2">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm transition-colors',
              active
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
            aria-pressed={active}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0 text-[10px] font-medium tabular-nums',
                  active
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-secondary text-muted-foreground',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
