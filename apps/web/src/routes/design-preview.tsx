import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';
import { GlassCard, GlassPill, StatusDot, type StatusTone } from '@/components/ui/glass-card';
import { useUiPreferencesStore } from '@/stores/ui-preferences';

/**
 * Living style guide for the v2 frosted-glass design system. Used during
 * the redesign rollout to validate tokens + components in isolation
 * before they're applied to real routes. Hidden from production nav —
 * accessed by typing /app/__design directly.
 *
 * Once the redesign lands across every page this route can be deleted
 * (or moved to a Storybook setup if we ever ship one).
 */
export const designPreviewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/__design',
  component: DesignPreview,
});

function DesignPreview() {
  return (
    <div className="mx-auto max-w-6xl space-y-10 p-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Design system v2 — frosted glass</h1>
        <p className="text-muted-foreground">
          Reference page for the new tokens. Compare against the SugarCRM mockup the redesign
          is based on. Open the dev tools and toggle{' '}
          <code className="rounded bg-secondary px-1.5 py-0.5 text-xs">prefers-reduced-transparency</code>{' '}
          to see the fallback for browsers without backdrop-filter.
        </p>
      </header>

      <Section title="Surfaces">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <GlassCard className="p-6">
            <h3 className="font-medium">Default glass card</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Standard panel — list rows, detail tabs, kanban cards.
            </p>
          </GlassCard>
          <GlassCard elevation="elevated" className="p-6">
            <h3 className="font-medium">Elevated glass</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Modals, popovers, focused detail panels. Stronger blur + shadow.
            </p>
          </GlassCard>
        </div>
      </Section>

      <Section title="Pills (toolbar / sidebar)">
        <GlassCard className="flex flex-wrap items-center gap-2 p-4">
          <GlassPill>Relationship</GlassPill>
          <GlassPill>Opportunities</GlassPill>
          <GlassPill>Leads</GlassPill>
          <GlassPill active>Cases</GlassPill>
          <GlassPill>Reports</GlassPill>
          <GlassPill>Quotes</GlassPill>
        </GlassCard>
      </Section>

      <Section title="Status dots">
        <GlassCard className="flex items-center gap-6 p-4 text-sm">
          <Tone tone="blue" label="In progress" />
          <Tone tone="amber" label="Pending" />
          <Tone tone="pink" label="Blocked" />
          <Tone tone="green" label="Done" />
          <Tone tone="muted" label="Inactive" />
        </GlassCard>
      </Section>

      <Section title="Density toggle">
        <DensityDemo />
      </Section>

      <Section title="Tenant accent">
        <AccentDemo />
      </Section>

      <Section title="Layout — Kanban-style flow (mockup reference)">
        <GlassCard className="p-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <KanbanColumn title="Case Allocation" tone="amber">
              <KanbanCard initials="AB" title="Allocate Case to User" />
              <KanbanCard initials="CD" title="Acknowledge Case receipt" />
            </KanbanColumn>
            <KanbanColumn title="Issue Identification" tone="blue">
              <KanbanCard initials="EF" title="Identify Issue Category" />
              <KanbanCard initials="GH" title="Identify Issue Severity" />
              <KanbanCard initials="IJ" title="Identify Issue Impact" />
            </KanbanColumn>
            <KanbanColumn title="Technical Resolution" tone="pink">
              <KanbanCard initials="KL" title="Identify Resolution" />
              <KanbanCard initials="MN" title="Estimate Resolution Time" />
            </KanbanColumn>
            <KanbanColumn title="New Tasks" tone="green">
              <KanbanCard initials="OP" title="Customer Communication" highlighted />
              <KanbanCard initials="QR" title="Customer Notification" />
            </KanbanColumn>
          </div>
        </GlassCard>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

function DensityDemo() {
  const density = useUiPreferencesStore((s) => s.density);
  const setDensity = useUiPreferencesStore((s) => s.setDensity);
  return (
    <GlassCard className="p-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm">Densitate curentă:</span>
        <GlassPill active={density === 'comfortable'} onClick={() => setDensity('comfortable')}>
          Confortabil
        </GlassPill>
        <GlassPill active={density === 'compact'} onClick={() => setDensity('compact')}>
          Compact
        </GlassPill>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Modifică <code className="rounded bg-secondary px-1 py-0.5 text-xs">--density-scale</code>{' '}
        global. Lista de mai jos folosește <code className="rounded bg-secondary px-1 py-0.5 text-xs">.dense-px</code>,{' '}
        <code className="rounded bg-secondary px-1 py-0.5 text-xs">.dense-py</code>,{' '}
        <code className="rounded bg-secondary px-1 py-0.5 text-xs">.dense-h</code> pentru a se strânge cu ~15%.
      </p>
      <ul className="mt-4 dense-gap-y space-y-px">
        {['Apel ratat — Cristian Olteanu', 'Reminder: follow-up ACME', 'Deal won: Magnetic SRL', 'Quote v2 trimisă'].map((t) => (
          <li
            key={t}
            className="dense-h dense-px flex items-center gap-3 rounded-md border border-border/50 bg-card/60 text-sm"
          >
            <StatusDot tone="blue" />
            {t}
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

const ACCENT_PRESETS: { label: string; hsl: string }[] = [
  { label: 'Default (negru)', hsl: '222 47% 11%' },
  { label: 'Albastru',         hsl: '217 91% 60%' },
  { label: 'Verde',            hsl: '142 71% 45%' },
  { label: 'Roz',              hsl: '339 90% 67%' },
  { label: 'Chihlimbar',       hsl: '38 92% 50%' },
];

function AccentDemo() {
  const accent = useUiPreferencesStore((s) => s.accentTenant);
  const setAccent = useUiPreferencesStore((s) => s.setAccentTenant);
  return (
    <GlassCard className="p-6">
      <p className="mb-3 text-sm">
        Per-tenant accent. Se aplică pe focus rings, status dots tematici și unele butoane (în viitor).
        Default = aceeași valoare ca <code className="rounded bg-secondary px-1 py-0.5 text-xs">--primary</code>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {ACCENT_PRESETS.map((p) => (
          <button
            key={p.hsl}
            type="button"
            onClick={() => setAccent(p.hsl)}
            className="flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1.5 text-xs hover:bg-card"
            data-active={accent === p.hsl ? 'true' : undefined}
          >
            <span
              className="inline-block h-3 w-3 rounded-full"
              style={{ backgroundColor: `hsl(${p.hsl})` }}
            />
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-3">
        <span className="text-xs text-muted-foreground">Demo focus ring:</span>
        <input
          type="text"
          placeholder="Click + Tab pentru focus"
          className="rounded-md border border-border bg-card/70 px-3 py-1.5 text-sm outline-none focus-visible:ring-2"
          style={{ outlineColor: 'transparent', boxShadow: undefined }}
        />
        <span className="text-[11px] text-muted-foreground">
          (HSL curent: <code>{accent}</code>)
        </span>
      </div>
    </GlassCard>
  );
}

function Tone({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot tone={tone} />
      {label}
    </span>
  );
}

function KanbanColumn({
  title,
  tone,
  children,
}: {
  title: string;
  tone: StatusTone;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="inline-flex items-center gap-2 font-medium uppercase tracking-wider">
          <StatusDot tone={tone} />
          {title}
        </span>
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function KanbanCard({
  initials,
  title,
  highlighted,
}: {
  initials: string;
  title: string;
  highlighted?: boolean;
}) {
  return (
    <div
      className={
        highlighted
          ? 'flex items-center gap-3 rounded-md bg-primary p-3 text-primary-foreground shadow-glass-elev'
          : 'flex items-center gap-3 rounded-md bg-card/70 p-3 backdrop-blur-glass border border-border/70'
      }
    >
      <span
        className={
          'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-medium ' +
          (highlighted ? 'bg-white/15 text-white' : 'bg-muted text-muted-foreground')
        }
      >
        {initials}
      </span>
      <span className="text-sm font-medium leading-tight">{title}</span>
    </div>
  );
}
