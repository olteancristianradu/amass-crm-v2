import * as React from 'react';
import { Link, useRouter } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Cog,
  Contact2,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Files,
  Globe2,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Mail,
  Map,
  Menu,
  Minimize2,
  Monitor,
  Moon,
  Sun,
  Network,
  Package,
  PartyPopper,
  Phone,
  Receipt,
  Rows3,
  Search,
  Send,
  Settings2,
  ShoppingBag,
  Sparkles,
  Target,
  Users,
  UsersRound,
  Webhook,
  X,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/auth';
import { useUiPreferencesStore } from '@/stores/ui-preferences';
import { useCommandPaletteStore } from '@/stores/command-palette';
import { api } from '@/lib/api';
import { CommandPalette } from '@/components/ui/command-palette';
import { Toaster } from '@/components/ui/Toaster';
import { OfflineBanner } from '@/components/ui/OfflineBanner';
import { useReminderPoller } from '@/hooks/useReminderPoller';
import { NotificationsBell } from './NotificationsBell';

interface Props {
  children: React.ReactNode;
}

/**
 * Authenticated shell — design system v2 (frosted glass + grouped nav).
 *
 * Layout:
 *   ┌──────────────┬─────────────────────────────────────────┐
 *   │  Sidebar     │  Topbar (sticky, glass-elev)            │
 *   │  (glass-card)├─────────────────────────────────────────┤
 *   │  Grouped nav │                                         │
 *   │  + sections  │  Page content (canvas, no inner card)   │
 *   │              │                                         │
 *   └──────────────┴─────────────────────────────────────────┘
 *
 * Improvements over the previous flat 35-link sidebar:
 *   - Nav grouped into 7 thematic sections (Work / Customers / Sales /
 *     Service / Marketing / Operations / Insights), with optional
 *     Settings under a collapsed group for OWNER+ADMIN.
 *   - Each link has a Lucide icon for scannability.
 *   - Active link rendered as a pill in the tenant accent (defaults
 *     near-black). Hover gives a subtle ghost surface.
 *   - Topbar pulls in a density toggle (Comfortable / Compact) and the
 *     existing search + notification bell + logout actions.
 *   - Mobile: sidebar collapses to a slide-in drawer triggered by a
 *     hamburger button in the topbar. Topbar + content remain readable.
 */
export function AppShell({ children }: Props): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const queryClient = useQueryClient();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const paletteOpen = useCommandPaletteStore((s) => s.isOpen);
  const setPaletteOpen = useCommandPaletteStore((s) => s.set);
  const togglePalette = useCommandPaletteStore((s) => s.toggle);
  useReminderPoller();

  // Global ⌘K / Ctrl+K toggle, "/" to focus when not already typing in a form.
  React.useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        togglePalette();
        return;
      }
      if (e.key === '/' && !paletteOpen) {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const editable = target?.isContentEditable;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || editable) return;
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePalette, setPaletteOpen, paletteOpen]);

  const handleLogout = async (): Promise<void> => {
    try {
      await api.post('/auth/logout');
    } catch {
      // Logout is fire-and-forget; even if the API call fails, wipe local state.
    }
    // M-aud-H4: drop every cached server response. Without this, opening
    // /companies on the next user that logs in on the same tab serves
    // the previous tenant's data from React Query's stale-while-revalidate
    // cache (default 5min). Server-side RLS still prevents cross-tenant
    // *fetches*, but the FE renders the stale snapshot until the refetch
    // resolves.
    queryClient.clear();
    clear();
    // PWA cache hygiene: nuke any cached /api/v1/companies + /contacts
    // responses so the next user on this device doesn't see them. The SW
    // also gets a CLEAR_CACHES message in case it's holding shell-cache
    // entries that referenced auth-bearing API URLs.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.controller?.postMessage({ type: 'CLEAR_CACHES' });
    }
    if (window.caches) {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch {
        // best-effort
      }
    }
    await router.navigate({ to: '/login' });
  };

  const isAdmin = user?.role === 'OWNER' || user?.role === 'ADMIN';

  return (
    <div className="flex min-h-screen">
      {/* ── Sidebar (desktop) ─────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col p-3 md:flex">
        <div className="glass-card flex h-full flex-col overflow-hidden">
          <Brand />
          <SidebarNav isAdmin={isAdmin} />
        </div>
      </aside>

      {/* ── Mobile drawer ─────────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          {/* Backdrop */}
          <div
            className="flex-1 bg-black/30 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden
          />
          <aside className="flex w-72 flex-col p-3">
            <div className="glass-card glass-elev flex h-full flex-col overflow-hidden">
              <div className="flex items-center justify-between border-b border-border/70 px-4 py-3">
                <Brand condensed />
                <button
                  type="button"
                  onClick={() => setDrawerOpen(false)}
                  className="rounded-md p-1 hover:bg-secondary"
                  aria-label="Închide meniul"
                >
                  <X size={18} />
                </button>
              </div>
              <SidebarNav isAdmin={isAdmin} onNavigate={() => setDrawerOpen(false)} />
            </div>
          </aside>
        </div>
      )}

      {/* ── Main column ──────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineBanner />
        <Topbar
          user={user}
          onLogout={handleLogout}
          onMenu={() => setDrawerOpen(true)}
          onSearch={() => setPaletteOpen(true)}
        />
        <main className="flex-1 px-4 py-6 md:px-8">{children}</main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Toaster />
    </div>
  );
}

// ─── Brand ─────────────────────────────────────────────────────────────

function Brand({ condensed = false }: { condensed?: boolean }): JSX.Element {
  return (
    <div
      className={cn(
        'flex items-center gap-2 px-4',
        condensed ? 'py-0' : 'h-14 border-b border-border/70',
      )}
    >
      <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Sparkles size={16} />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold tracking-tight">AMASS</span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">crm</span>
      </div>
    </div>
  );
}

// ─── Sidebar nav ───────────────────────────────────────────────────────

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  exact?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Lucru',
    items: [
      { to: '/app', label: 'Dashboard', icon: LayoutDashboard, exact: true },
      { to: '/app/tasks', label: 'Task-uri', icon: CheckSquare },
      { to: '/app/reminders', label: 'Reminder-uri', icon: Clock },
      { to: '/app/calendar', label: 'Calendar', icon: Calendar },
      { to: '/app/notifications', label: 'Notificări', icon: Bell },
    ],
  },
  {
    title: 'Clienți',
    items: [
      { to: '/app/companies', label: 'Companii', icon: Building2 },
      { to: '/app/contacts', label: 'Contacte', icon: Contact2 },
      { to: '/app/clients', label: 'Clienți (B2C)', icon: Users },
      { to: '/app/leads', label: 'Leads', icon: Target },
      { to: '/app/contact-segments', label: 'Segmente', icon: UsersRound },
    ],
  },
  {
    title: 'Vânzări',
    items: [
      { to: '/app/deals', label: 'Pipeline', icon: KanbanSquare },
      { to: '/app/forecasting', label: 'Prognoze', icon: LineChart },
      { to: '/app/quotes', label: 'Oferte', icon: FileText },
      { to: '/app/orders', label: 'Comenzi', icon: ShoppingBag },
      { to: '/app/contracts', label: 'Contracte', icon: Files },
      { to: '/app/subscriptions', label: 'Abonamente', icon: CircleDollarSign },
      { to: '/app/commissions', label: 'Comisioane', icon: Receipt },
      { to: '/app/territories', label: 'Teritorii', icon: Map },
    ],
  },
  {
    title: 'Service',
    items: [
      { to: '/app/cases', label: 'Tichete suport', icon: ClipboardList },
      { to: '/app/approvals', label: 'Aprobări', icon: ListChecks },
    ],
  },
  {
    title: 'Marketing',
    items: [
      { to: '/app/campaigns', label: 'Campanii', icon: Send },
      { to: '/app/email-sequences', label: 'Secvențe email', icon: Mail },
      { to: '/app/events', label: 'Evenimente', icon: PartyPopper },
    ],
  },
  {
    title: 'Operațional',
    items: [
      { to: '/app/invoices', label: 'Facturi', icon: Receipt },
      { to: '/app/projects', label: 'Proiecte', icon: Briefcase },
      { to: '/app/products', label: 'Produse', icon: Package },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/app/reports', label: 'Rapoarte', icon: FileSpreadsheet },
      { to: '/app/workflows', label: 'Automatizări', icon: Network },
      { to: '/app/audit', label: 'Jurnal audit', icon: Activity },
    ],
  },
];

const ADMIN_SECTION: NavSection = {
  title: 'Administrare',
  items: [
    { to: '/app/settings/users', label: 'Utilizatori', icon: Users },
    { to: '/app/settings/custom-fields', label: 'Câmpuri custom', icon: Rows3 },
    { to: '/app/settings/webhooks', label: 'Webhook-uri', icon: Webhook },
    { to: '/app/settings/billing', label: 'Facturare', icon: CreditCard },
    { to: '/app/email-settings', label: 'Setări email', icon: Mail },
    { to: '/app/phone-settings', label: 'Telefonie', icon: Phone },
    { to: '/app/settings/2fa', label: 'Securitate (2FA)', icon: KeyRound },
  ],
};

function SidebarNav({
  isAdmin,
  onNavigate,
}: {
  isAdmin: boolean;
  onNavigate?: () => void;
}): JSX.Element {
  const sections = isAdmin ? [...SECTIONS, ADMIN_SECTION] : SECTIONS;
  return (
    <nav className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
      {sections.map((section) => (
        <NavGroup key={section.title} section={section} onNavigate={onNavigate} />
      ))}
    </nav>
  );
}

function NavGroup({
  section,
  onNavigate,
}: {
  section: NavSection;
  onNavigate?: () => void;
}): JSX.Element {
  return (
    <div className="space-y-1">
      <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
        {section.title}
      </div>
      <ul className="dense-gap-y space-y-px">
        {section.items.map((item) => (
          <li key={item.to}>
            <NavLink {...item} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function NavLink({
  to,
  label,
  icon: Icon,
  exact,
  onNavigate,
}: NavItem & { onNavigate?: () => void }): JSX.Element {
  return (
    <Link
      to={to}
      activeOptions={{ exact: exact ?? false }}
      onClick={onNavigate}
      className="group flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      activeProps={{
        className:
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium bg-primary text-primary-foreground hover:bg-primary',
      }}
    >
      <Icon size={16} />
      <span className="truncate">{label}</span>
    </Link>
  );
}

// ─── Topbar ────────────────────────────────────────────────────────────

function Topbar({
  user,
  onLogout,
  onMenu,
  onSearch,
}: {
  user: { fullName: string; email: string; role: string } | null;
  onLogout: () => void;
  onMenu: () => void;
  onSearch: () => void;
}): JSX.Element {
  const isMac =
    typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return (
    <header className="sticky top-0 z-30 px-4 pt-3 md:px-8">
      <div className="glass-card flex h-14 items-center gap-3 px-4">
        {/* Mobile menu */}
        <button
          type="button"
          onClick={onMenu}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
          aria-label="Deschide meniul"
        >
          <Menu size={18} />
        </button>

        {/* Search trigger → opens Cmd-K palette */}
        <button
          type="button"
          onClick={onSearch}
          className="group flex h-9 min-w-0 flex-1 max-w-md items-center gap-2.5 rounded-md border border-border/70 bg-card/60 px-3 text-left text-sm text-muted-foreground transition-colors hover:bg-card"
          aria-label="Deschide căutarea"
          title="Caută (⌘K)"
        >
          <Search size={14} />
          <span className="min-w-0 flex-1 truncate">Caută pagini, companii, contacte…</span>
          <kbd className="hidden items-center gap-0.5 rounded border border-border/70 bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide sm:inline-flex">
            {isMac ? '⌘' : 'Ctrl'}K
          </kbd>
        </button>

        {/* Right cluster */}
        <ThemeToggle />
        <DensityToggle />
        <NotificationsBell />
        <UserMenu user={user} onLogout={onLogout} />
      </div>
    </header>
  );
}

/**
 * Cycle through three states on each click: system → light → dark → system.
 * The icon mirrors the active state so a quick glance tells you which
 * theme is selected (Sun=light, Moon=dark, Monitor=follow OS).
 */
function ThemeToggle(): JSX.Element {
  const theme = useUiPreferencesStore((s) => s.theme);
  const setTheme = useUiPreferencesStore((s) => s.setTheme);
  const next: typeof theme = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system';
  const Icon = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor;
  const label =
    theme === 'system'
      ? 'Temă: urmează sistemul (click → luminoasă)'
      : theme === 'light'
        ? 'Temă: luminoasă (click → întunecată)'
        : 'Temă: întunecată (click → sistem)';
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:inline-flex"
      title={label}
      aria-label={label}
    >
      <Icon size={16} />
    </button>
  );
}

function DensityToggle(): JSX.Element {
  const density = useUiPreferencesStore((s) => s.density);
  const setDensity = useUiPreferencesStore((s) => s.setDensity);
  const next: typeof density = density === 'compact' ? 'comfortable' : 'compact';
  const label =
    density === 'compact'
      ? 'Densitate: compactă (click → confortabilă)'
      : 'Densitate: confortabilă (click → compactă)';
  return (
    <button
      type="button"
      onClick={() => setDensity(next)}
      className="hidden h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground sm:inline-flex"
      title={label}
      aria-label={label}
    >
      <Minimize2 size={16} className={density === 'compact' ? 'text-foreground' : ''} />
    </button>
  );
}

function UserMenu({
  user,
  onLogout,
}: {
  user: { fullName: string; email: string; role: string } | null;
  onLogout: () => void;
}): JSX.Element {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const initials = (user?.fullName ?? user?.email ?? '?')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-2 py-1 text-sm transition-colors hover:bg-card"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-medium">
          {initials || '?'}
        </span>
        <ChevronDown size={14} className="hidden text-muted-foreground sm:inline" />
      </button>
      {open && (
        <div className="glass-card glass-elev absolute right-0 top-12 z-50 w-60 overflow-hidden p-2">
          {user && (
            <div className="border-b border-border/70 px-3 py-2 text-sm">
              <div className="font-medium leading-tight">{user.fullName}</div>
              <div className="truncate text-xs text-muted-foreground">{user.email}</div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {user.role}
              </div>
            </div>
          )}
          <Link
            to="/app/settings/2fa"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground hover:bg-secondary"
          >
            <Settings2 size={14} /> Setări cont
          </Link>
          <Link
            to="/app/__design"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-secondary"
          >
            <Globe2 size={14} /> Vizualizare design
          </Link>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-secondary"
          >
            <Cog size={14} /> Deconectare
          </button>
        </div>
      )}
    </div>
  );
}
