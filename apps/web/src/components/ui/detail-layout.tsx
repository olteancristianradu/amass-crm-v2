import { type ReactNode, Children, isValidElement } from 'react';
import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Detail-page layout primitive used across resources (Company, Contact,
 * Client, Deal, Lead, Quote, Invoice, Project).
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │ back · NAME (large)                                  ┌ actions │
 *   ├────────────────────────────────────────────────────────────────┤
 *   │ Main column (sticky tabs + content)        │  Sidebar          │
 *   │                                            │  (health, meta)   │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * The TabBar lives at the top of the main column so it's the navigation
 * anchor of the page — meta info is the supporting cast in the sidebar.
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
      <header className="mb-6">
        {backHref && (
          <Link
            to={backHref}
            className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            <ChevronLeft size={12} />
            {backLabel ?? 'Înapoi'}
          </Link>
        )}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">{title}</h1>
            {subtitle && (
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                {subtitle}
              </div>
            )}
          </div>
          {actions && (
            <div className="flex flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      </header>

      <div
        className={cn(
          'grid gap-6',
          sidebar ? 'lg:grid-cols-[1fr_320px]' : '',
        )}
      >
        <main className="min-w-0 space-y-4 order-2 lg:order-1">{children}</main>
        {sidebar && (
          <aside className="space-y-4 order-1 lg:order-2 lg:sticky lg:top-4 lg:self-start">
            {sidebar}
          </aside>
        )}
      </div>
    </div>
  );
}

/**
 * Solid card with quietly-labeled rows. Replaces the previous GlassCard
 * variant — info is data-heavy reading, not floating glass. Section title
 * is sentence-case + small + muted, not screaming ALL-CAPS.
 *
 * Empty children (where every DetailField has no value) won't render the
 * card at all — we filter them in render so a card with no data simply
 * disappears instead of showing four em-dashes.
 */
export function DetailFields({
  title,
  children,
}: {
  title?: ReactNode;
  children: ReactNode;
}): JSX.Element | null {
  // Filter children to only those DetailFields with a real value.
  // Anything else (custom JSX) we always keep — we can't introspect it.
  const arr = Children.toArray(children).filter((child) => {
    if (!isValidElement(child)) return true;
    const childType = (child.type as { displayName?: string; name?: string }) ?? {};
    const isDetailField = childType.displayName === 'DetailField' || childType.name === 'DetailField';
    if (!isDetailField) return true;
    const props = child.props as { value?: ReactNode };
    if (props.value === undefined || props.value === null || props.value === '') return false;
    return true;
  });
  if (arr.length === 0) return null;

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
      {title && (
        <h3 className="border-b border-border/60 px-4 py-2.5 text-xs font-semibold text-muted-foreground">
          {title}
        </h3>
      )}
      <dl className="divide-y divide-border/40 text-sm">{arr}</dl>
    </section>
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
}): JSX.Element | null {
  // Hide rows with no value at all — the parent already skips empty cards.
  // We still bail here so a mixed group (some filled, some empty) only
  // shows the filled ones instead of em-dash padding.
  if (value === undefined || value === null || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'min-w-0 truncate text-right text-foreground',
          copyable ? 'font-mono text-xs tabular-nums' : 'font-medium',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
// Set displayName explicitly so the filter in DetailFields can recognise
// the component even after build minification renames the function.
DetailField.displayName = 'DetailField';

/**
 * Tab pills using the v2 design system. Drop-in replacement for the
 * shadcn Tabs trigger row when a route wants the new look without
 * pulling in @radix-ui/react-tabs (which the current shadcn Tabs uses).
 *
 * Controlled via `value` + `onChange`, render content yourself based on
 * the active tab — keeps the API tiny and avoids portal headaches.
 *
 * The bar sticks to the top of the main column so it's the constant
 * anchor as the user scrolls long timelines / activity lists.
 */
export interface TabBarProps<T extends string> {
  tabs: { value: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (next: T) => void;
}

export function TabBar<T extends string>({ tabs, value, onChange }: TabBarProps<T>): JSX.Element {
  return (
    <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card/95 px-1 py-1.5 shadow-sm backdrop-blur-md">
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
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
                  'rounded-full px-1.5 py-0 text-[10px] font-semibold tabular-nums',
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
