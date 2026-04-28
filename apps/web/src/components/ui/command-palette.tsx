/**
 * CommandPalette — global Cmd/Ctrl+K (or "/") fuzzy navigator + semantic search.
 *
 * Two stacked sections:
 *   1. "Navigare" — instant prefix/substring matches against every CRM route
 *      (sidebar nav + a few power actions). Always shown when query is empty.
 *   2. "Căutare globală" — debounced (220ms) call into `/ai/search` for
 *      cross-entity semantic results (companies / contacts / clients).
 *
 * Keyboard:
 *   - Cmd/Ctrl+K, "/" anywhere → open
 *   - Esc → close
 *   - ↑ / ↓ → move highlighted row (wraps)
 *   - Enter → execute selected row
 */
import * as React from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  Briefcase,
  Building2,
  Calendar,
  CheckSquare,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Command,
  Contact2,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Files,
  KanbanSquare,
  KeyRound,
  LayoutDashboard,
  LineChart,
  ListChecks,
  Mail,
  Map,
  Network,
  Package,
  PartyPopper,
  Phone,
  Receipt,
  Rows3,
  Search,
  Send,
  ShoppingBag,
  Sparkles,
  Target,
  Users,
  UsersRound,
  Webhook,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { searchApi, type ParsedIntent } from '@/features/search/api';
import { cn } from '@/lib/cn';

// ─── nav catalog ──────────────────────────────────────────────────────────

export interface NavCommand {
  id: string;
  label: string;
  group: string;
  to: string;
  keywords: string;
  icon: React.ComponentType<{ size?: number }>;
  adminOnly?: boolean;
}

// Exported for unit tests.
export const NAV_COMMANDS: NavCommand[] = [
  // Lucru
  { id: 'dashboard', label: 'Dashboard', group: 'Lucru', to: '/app', keywords: 'home start brief acasa', icon: LayoutDashboard },
  { id: 'tasks', label: 'Task-uri', group: 'Lucru', to: '/app/tasks', keywords: 'todo de facut', icon: CheckSquare },
  { id: 'reminders', label: 'Reminder-uri', group: 'Lucru', to: '/app/reminders', keywords: 'aducere aminte', icon: Clock },
  { id: 'calendar', label: 'Calendar', group: 'Lucru', to: '/app/calendar', keywords: 'agenda', icon: Calendar },
  { id: 'notifications', label: 'Notificări', group: 'Lucru', to: '/app/notifications', keywords: 'alerte mesaje', icon: Bell },

  // Clienți
  { id: 'companies', label: 'Companii', group: 'Clienți', to: '/app/companies', keywords: 'firme b2b organizatii', icon: Building2 },
  { id: 'contacts', label: 'Contacte', group: 'Clienți', to: '/app/contacts', keywords: 'persoane', icon: Contact2 },
  { id: 'clients', label: 'Clienți (B2C)', group: 'Clienți', to: '/app/clients', keywords: 'persoane fizice', icon: Users },
  { id: 'leads', label: 'Leads', group: 'Clienți', to: '/app/leads', keywords: 'prospecti', icon: Target },
  { id: 'segments', label: 'Segmente', group: 'Clienți', to: '/app/contact-segments', keywords: 'liste audientă', icon: UsersRound },

  // Vânzări
  { id: 'deals', label: 'Pipeline (deal-uri)', group: 'Vânzări', to: '/app/deals', keywords: 'kanban tranzactii', icon: KanbanSquare },
  { id: 'forecasting', label: 'Prognoze', group: 'Vânzări', to: '/app/forecasting', keywords: 'previzionare buget', icon: LineChart },
  { id: 'quotes', label: 'Oferte', group: 'Vânzări', to: '/app/quotes', keywords: 'proposal preturi', icon: FileText },
  { id: 'orders', label: 'Comenzi', group: 'Vânzări', to: '/app/orders', keywords: 'order-uri vanzari', icon: ShoppingBag },
  { id: 'contracts', label: 'Contracte', group: 'Vânzări', to: '/app/contracts', keywords: 'documente legal', icon: Files },
  { id: 'subscriptions', label: 'Abonamente', group: 'Vânzări', to: '/app/subscriptions', keywords: 'recurring mrr', icon: CircleDollarSign },
  { id: 'commissions', label: 'Comisioane', group: 'Vânzări', to: '/app/commissions', keywords: 'plata agent', icon: Receipt },
  { id: 'territories', label: 'Teritorii', group: 'Vânzări', to: '/app/territories', keywords: 'arie zone', icon: Map },

  // Service
  { id: 'cases', label: 'Tichete suport', group: 'Service', to: '/app/cases', keywords: 'support cases ticketing', icon: ClipboardList },
  { id: 'approvals', label: 'Aprobări', group: 'Service', to: '/app/approvals', keywords: 'aprobat respins', icon: ListChecks },

  // Marketing
  { id: 'campaigns', label: 'Campanii', group: 'Marketing', to: '/app/campaigns', keywords: 'newsletter blast', icon: Send },
  { id: 'sequences', label: 'Secvențe email', group: 'Marketing', to: '/app/email-sequences', keywords: 'drip campanii', icon: Mail },
  { id: 'events', label: 'Evenimente', group: 'Marketing', to: '/app/events', keywords: 'workshop conferinta webinar', icon: PartyPopper },

  // Operațional
  { id: 'invoices', label: 'Facturi', group: 'Operațional', to: '/app/invoices', keywords: 'factura emisa', icon: Receipt },
  { id: 'projects', label: 'Proiecte', group: 'Operațional', to: '/app/projects', keywords: 'project managment livrabile', icon: Briefcase },
  { id: 'products', label: 'Produse', group: 'Operațional', to: '/app/products', keywords: 'catalog sku', icon: Package },

  // Insights
  { id: 'reports', label: 'Rapoarte', group: 'Insights', to: '/app/reports', keywords: 'analytics raport', icon: FileSpreadsheet },
  { id: 'workflows', label: 'Automatizări', group: 'Insights', to: '/app/workflows', keywords: 'workflow automation', icon: Network },
  { id: 'audit', label: 'Jurnal audit', group: 'Insights', to: '/app/audit', keywords: 'log activitate', icon: Activity },

  // Admin
  { id: 'users', label: 'Utilizatori', group: 'Administrare', to: '/app/settings/users', keywords: 'echipa roluri', icon: Users, adminOnly: true },
  { id: 'cf', label: 'Câmpuri custom', group: 'Administrare', to: '/app/settings/custom-fields', keywords: 'campuri proprii', icon: Rows3, adminOnly: true },
  { id: 'webhooks', label: 'Webhook-uri', group: 'Administrare', to: '/app/settings/webhooks', keywords: 'evenimente integrari', icon: Webhook, adminOnly: true },
  { id: 'billing', label: 'Facturare', group: 'Administrare', to: '/app/settings/billing', keywords: 'abonament plan stripe', icon: CreditCard, adminOnly: true },
  { id: 'email-set', label: 'Setări email', group: 'Administrare', to: '/app/email-settings', keywords: 'smtp', icon: Mail, adminOnly: true },
  { id: 'phone-set', label: 'Telefonie', group: 'Administrare', to: '/app/phone-settings', keywords: 'twilio', icon: Phone, adminOnly: true },
  { id: '2fa', label: 'Securitate (2FA)', group: 'Administrare', to: '/app/settings/2fa', keywords: 'totp parola', icon: KeyRound, adminOnly: true },
];

// Diacritic-insensitive match: "căutați" should match "cautat".
// Exported for unit testing — keep usage internal otherwise.
export function normalizeForCommand(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

const normalize = normalizeForCommand;

export function rankNavCommands(query: string, items: NavCommand[]): NavCommand[] {
  return rankNav(query, items);
}

function rankNav(query: string, items: NavCommand[]): NavCommand[] {
  if (!query.trim()) return items;
  const q = normalize(query.trim());
  const scored: { item: NavCommand; score: number }[] = [];
  for (const item of items) {
    const label = normalize(item.label);
    const keywords = normalize(item.keywords);
    let score = 0;
    if (label.startsWith(q)) score = 100;
    else if (label.includes(q)) score = 60;
    else if (keywords.includes(q)) score = 30;
    if (score > 0) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

// ─── component ────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface FlatRow {
  kind: 'nav' | 'remote';
  id: string;
  primary: string;
  secondary?: string;
  icon: React.ComponentType<{ size?: number }>;
  group: string;
  onSelect: () => void;
}

export function CommandPalette({ open, onOpenChange }: Props): JSX.Element | null {
  // Outer is a thin gate: when closed we render nothing, so opening always
  // remounts <PaletteBody> with fresh defaults — no reset effects needed.
  if (!open) return null;
  return <PaletteBody onOpenChange={onOpenChange} />;
}

function PaletteBody({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}): JSX.Element {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [highlightedRaw, setHighlighted] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  // Autofocus the input on mount (= each time palette opens).
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounce remote search to 220ms.
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 220);
    return () => clearTimeout(t);
  }, [query]);

  const visibleNav = React.useMemo(
    () => rankNav(query, NAV_COMMANDS.filter((c) => !c.adminOnly || isAdmin)),
    [query, isAdmin],
  );

  const remote = useQuery({
    queryKey: ['cmdk', debounced],
    queryFn: () => searchApi.semantic(debounced, 8),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  });

  // AI intent — only fires for inputs that start with a verb-like word
  // ("creează", "adaugă", "deschide", "mergi la", "task"). Saves on cost
  // for plain-text searches ("Popescu") since the static fallback would
  // just return search anyway.
  const aiHint = isAiLike(debounced);
  const intent = useQuery({
    queryKey: ['cmdk-intent', debounced],
    queryFn: () => searchApi.parseIntent(debounced),
    enabled: aiHint && debounced.length >= 4,
    staleTime: 60_000,
  });

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  // Build flat row list (used for keyboard nav).
  const rows = React.useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const c of visibleNav) {
      out.push({
        kind: 'nav',
        id: `nav:${c.id}`,
        primary: c.label,
        secondary: c.group,
        icon: c.icon,
        group: 'Navigare',
        onSelect: () => {
          close();
          void navigate({ to: c.to });
        },
      });
    }
    if (intent.data && intent.data.kind !== 'unknown' && intent.data.kind !== 'search') {
      out.push({
        kind: 'remote',
        id: `intent:${intent.data.kind}`,
        primary: intent.data.label,
        secondary: 'Acțiune AI',
        icon: Sparkles,
        group: 'Acțiuni AI',
        onSelect: () => {
          close();
          executeIntent(intent.data, navigate);
        },
      });
    }
    if (remote.data?.results.length) {
      const typeIcons = { company: Building2, contact: Contact2, client: Users };
      const typeRoutes = {
        company: '/app/companies/$id' as const,
        contact: '/app/contacts/$id' as const,
        client: '/app/clients/$id' as const,
      };
      for (const r of remote.data.results) {
        out.push({
          kind: 'remote',
          id: `remote:${r.type}:${r.id}`,
          primary: r.label,
          secondary: r.subtitle || undefined,
          icon: typeIcons[r.type] ?? Sparkles,
          group: 'Căutare globală',
          onSelect: () => {
            close();
            void navigate({ to: typeRoutes[r.type], params: { id: r.id } });
          },
        });
      }
    }
    return out;
  }, [visibleNav, remote.data, intent.data, close, navigate]);

  // Clamp highlighted index inline (avoids a setState-in-effect cascade).
  const highlighted = rows.length === 0 ? 0 : Math.min(highlightedRaw, rows.length - 1);

  // Scroll the highlighted row into view.
  React.useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-cmdk-row="${highlighted}"]`,
    );
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (rows.length > 0) setHighlighted((i) => (i + 1) % rows.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length > 0) setHighlighted((i) => (i - 1 + rows.length) % rows.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      rows[highlighted]?.onSelect();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Paletă de comenzi"
      onKeyDown={handleKeyDown}
      className="fixed inset-0 z-[60] flex items-start justify-center px-4 pt-[12vh]"
    >
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Închide paleta"
        onClick={close}
        className="fixed inset-0 bg-black/30 backdrop-blur-sm"
        tabIndex={-1}
      />

      <div className="glass-card glass-elev relative z-10 flex w-full max-w-xl flex-col overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <Search size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Caută pagini, companii, contacte…"
            className="min-w-0 flex-1 bg-transparent text-sm placeholder:text-muted-foreground focus:outline-none"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden items-center gap-1 rounded-md border border-border/70 bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground sm:inline-flex">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto p-2">
          <ResultGroups rows={rows} highlighted={highlighted} setHighlighted={setHighlighted} />

          {rows.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {debounced.length >= 2 && remote.isPending
                ? 'Se caută…'
                : 'Niciun rezultat. Încearcă un alt termen.'}
            </div>
          )}
        </div>

        {/* Footer hints */}
        <div className="flex items-center justify-between border-t border-border/70 bg-secondary/30 px-4 py-2 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-card px-1 py-0.5">↑</kbd>
              <kbd className="rounded bg-card px-1 py-0.5">↓</kbd>
              navighează
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-card px-1 py-0.5">↵</kbd>
              deschide
            </span>
          </div>
          <span className="flex items-center gap-1">
            <Command size={11} /> palette
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Heuristic: only call /ai/intent when the input looks like a command,
 * not a plain-text search. Keeps the request count low for what is
 * almost always a search use case.
 *
 * Matches Romanian + English imperatives and "deschide/mergi la".
 */
function isAiLike(s: string): boolean {
  if (!s) return false;
  const re = /^(creeaz[ăa]|adaug[ăa]|fa|f[ăa]|task|reminder|deschide|mergi|deal|companie|contact|client|invoice|factur[ăa]|create|add|open)\b/i;
  return re.test(s.trim());
}

/**
 * Map a parsed AI intent to actual navigation. For create_* intents we
 * land on the list page with `?new=…&prefill=…` — the list page picks
 * up the prefill and opens its own create form.
 */
function executeIntent(
  intent: ParsedIntent,
  navigate: ReturnType<typeof useNavigate>,
): void {
  switch (intent.kind) {
    case 'navigate': {
      const slug = intentTargetToRoute(intent.target ?? '');
      void navigate({ to: slug });
      return;
    }
    case 'create_company':
      void navigate({ to: '/app/companies', search: { new: intent.target ?? '' } as never });
      return;
    case 'create_contact':
      void navigate({ to: '/app/contacts', search: { new: intent.target ?? '' } as never });
      return;
    case 'create_deal':
      void navigate({ to: '/app/deals', search: { new: intent.target ?? '' } as never });
      return;
    case 'create_task':
      void navigate({ to: '/app/tasks', search: { new: intent.target ?? '' } as never });
      return;
    case 'search':
    case 'unknown':
    default:
      // Falls back to no-op — the user can still hit the regular search results.
      return;
  }
}

function intentTargetToRoute(target: string): '/app' | '/app/companies' | '/app/contacts' | '/app/clients' | '/app/leads' | '/app/deals' | '/app/tasks' | '/app/invoices' | '/app/quotes' | '/app/reports' {
  const t = target.toLowerCase().replace(/[^a-z]/g, '');
  if (t.startsWith('compani')) return '/app/companies';
  if (t.startsWith('contact')) return '/app/contacts';
  if (t.startsWith('client')) return '/app/clients';
  if (t.startsWith('lead')) return '/app/leads';
  if (t.startsWith('deal') || t === 'pipeline') return '/app/deals';
  if (t.startsWith('task')) return '/app/tasks';
  if (t.startsWith('factur') || t === 'invoices') return '/app/invoices';
  if (t.startsWith('ofert') || t === 'quotes') return '/app/quotes';
  if (t.startsWith('raport') || t === 'reports') return '/app/reports';
  return '/app';
}

function ResultGroups({
  rows,
  highlighted,
  setHighlighted,
}: {
  rows: FlatRow[];
  highlighted: number;
  setHighlighted: (i: number) => void;
}): JSX.Element {
  // Group sequential rows by `group` field while preserving the global index
  // (so ↓/↑ keys land on the right item).
  const groups: { name: string; rows: { row: FlatRow; index: number }[] }[] = [];
  rows.forEach((row, index) => {
    const last = groups[groups.length - 1];
    if (last && last.name === row.group) {
      last.rows.push({ row, index });
    } else {
      groups.push({ name: row.group, rows: [{ row, index }] });
    }
  });

  return (
    <>
      {groups.map((g) => (
        <div key={g.name} className="mb-2 last:mb-0">
          <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
            {g.name}
          </div>
          <ul className="space-y-px">
            {g.rows.map(({ row, index }) => (
              <li key={row.id}>
                <button
                  type="button"
                  data-cmdk-row={index}
                  onMouseEnter={() => setHighlighted(index)}
                  onClick={row.onSelect}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    index === highlighted
                      ? 'bg-primary text-primary-foreground'
                      : 'text-foreground hover:bg-secondary',
                  )}
                >
                  <row.icon size={15} />
                  <span className="min-w-0 flex-1 truncate">{row.primary}</span>
                  {row.secondary && (
                    <span
                      className={cn(
                        'truncate text-xs',
                        index === highlighted
                          ? 'text-primary-foreground/70'
                          : 'text-muted-foreground',
                      )}
                    >
                      {row.secondary}
                    </span>
                  )}
                  <ChevronRight
                    size={13}
                    className={cn(
                      'shrink-0 transition-opacity',
                      index === highlighted ? 'opacity-90' : 'opacity-0',
                    )}
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}
