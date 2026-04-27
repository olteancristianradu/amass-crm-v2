import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpRight,
  Briefcase,
  Mail,
  PhoneCall,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { GlassCard } from '@/components/ui/glass-card';
import { PageHeader } from '@/components/ui/page-header';
import { QueryError } from '@/components/ui/QueryError';

export const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: Dashboard,
});

interface DealStats {
  total: number;
  open: number;
  won: number;
  lost: number;
  totalValue: number;
  wonValue: number;
  avgDealValue: number;
}
interface ActivityStats { total: number; byType: { type: string; count: number }[] }
interface EmailStats { sent: number; failed: number; queued: number }
interface CallStats { total: number; completed: number; totalDurationSec: number; avgDurationSec: number }
interface PipelineStageStats { stageId: string; stageName: string; count: number; totalValue: number }
interface DashboardStats {
  deals: DealStats;
  pipeline: PipelineStageStats[];
  activities: ActivityStats;
  emails: EmailStats;
  calls: CallStats;
  period: { from: string; to: string };
}

function Dashboard(): JSX.Element {
  const user = useAuthStore((s) => s.user);

  const now = new Date();
  const toDate = now.toISOString().slice(0, 10);
  const fromDate = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);

  const { data, isError, error } = useQuery({
    queryKey: ['reports-dashboard', fromDate, toDate],
    queryFn: () => api.get<DashboardStats>('/reports/dashboard', { from: fromDate, to: toDate }),
    staleTime: 5 * 60 * 1000,
  });

  // Greeting based on local time-of-day. Backend AI Brief endpoint
  // (/dashboard/brief) lands in a separate sprint — for now we render
  // a static placeholder so the visual hierarchy is right.
  const hour = now.getHours();
  const greeting =
    hour < 5 ? 'Noapte bună' : hour < 12 ? 'Bună dimineața' : hour < 18 ? 'Bună ziua' : 'Bună seara';
  const firstName = user?.fullName?.split(/\s+/)[0] ?? '';

  return (
    <div>
      <PageHeader
        title={`${greeting}${firstName ? ', ' + firstName : ''}`}
        subtitle="Imagine de ansamblu pe ultimele 30 zile."
      />

      <QueryError isError={isError} error={error} />

      {/* AI Brief — hero strip. Static copy until /dashboard/brief endpoint
          ships in a follow-up. The card already lives where the real Claude
          paragraph will land, so when it arrives no layout shifts. */}
      <BriefStrip data={data} />

      {/* KPI grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          icon={Briefcase}
          title="Deals deschise"
          value={data?.deals.open ?? '—'}
          sub={data ? `${data.deals.total} total` : undefined}
          href="/app/deals"
        />
        <KpiTile
          icon={Trophy}
          title="Deals câștigate"
          value={data?.deals.won ?? '—'}
          sub={
            data
              ? `${data.deals.wonValue.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON`
              : undefined
          }
          tone="green"
        />
        <KpiTile
          icon={PhoneCall}
          title="Apeluri"
          value={data?.calls.total ?? '—'}
          sub={data ? `${data.calls.completed} finalizate` : undefined}
        />
        <KpiTile
          icon={Mail}
          title="Email-uri trimise"
          value={data?.emails.sent ?? '—'}
          sub={data ? `${data.emails.queued} în coadă` : undefined}
        />
      </div>

      {/* Pipeline + activity row */}
      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {data && data.pipeline.length > 0 && (
          <GlassCard className="overflow-hidden lg:col-span-2">
            <header className="flex items-center justify-between border-b border-border/70 px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold">Pipeline pe etape</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Distribuția deal-urilor active pe stage-uri
                </p>
              </div>
              <Link
                to="/app/deals"
                className="inline-flex items-center gap-1 text-xs text-foreground underline-offset-4 hover:underline"
              >
                Pipeline complet <ArrowUpRight size={12} />
              </Link>
            </header>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-secondary/20 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-5 py-2.5 font-medium">Etapă</th>
                  <th scope="col" className="px-4 py-2.5 text-right font-medium">Deals</th>
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">Valoare</th>
                </tr>
              </thead>
              <tbody>
                {data.pipeline.map((s, i) => {
                  const max = Math.max(...data.pipeline.map((x) => Number(x.totalValue) || 0), 1);
                  const pct = (Number(s.totalValue) / max) * 100;
                  return (
                    <tr
                      key={s.stageId}
                      className="border-b border-border/30 last:border-0 transition-colors hover:bg-secondary/30"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {String(i + 1).padStart(2, '0')}
                          </span>
                          <span>{s.stageName}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{s.count}</td>
                      <td className="px-5 py-3 text-right">
                        <div className="inline-flex items-center gap-3">
                          <span className="font-mono text-xs tabular-nums">
                            {Number(s.totalValue).toLocaleString('ro-RO', {
                              maximumFractionDigits: 0,
                            })}
                          </span>
                          <span
                            className="inline-block h-1.5 w-14 rounded-full bg-secondary"
                            aria-hidden
                          >
                            <span
                              className="block h-full rounded-full bg-primary"
                              style={{ width: `${pct}%` }}
                            />
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </GlassCard>
        )}

        {data && data.activities.byType.length > 0 && (
          <GlassCard className="p-5">
            <header className="mb-3">
              <h2 className="text-sm font-semibold">Activitate</h2>
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                {data.activities.total} acțiuni
              </p>
            </header>
            <ul className="space-y-2 text-sm">
              {data.activities.byType.slice(0, 6).map((a) => (
                <li key={a.type} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{a.type}</span>
                  <span className="font-medium tabular-nums">{a.count}</span>
                </li>
              ))}
            </ul>
          </GlassCard>
        )}
      </div>

      {!data && <p className="mt-4 text-sm text-muted-foreground">Se încarcă statisticile…</p>}
    </div>
  );
}

/**
 * Hero "AI brief" strip at the top of the dashboard. Today renders a
 * static, deterministic copy derived from the dashboard stats; once
 * /dashboard/brief lands in the API (Claude-generated 2-3 sentence
 * morning summary, cached 1h per tenant+user), this component will
 * swap to the live endpoint without changing the layout.
 */
function BriefStrip({ data }: { data: DashboardStats | undefined }): JSX.Element {
  let body: React.ReactNode;
  if (!data) {
    body = (
      <p className="text-sm text-muted-foreground">Se încarcă rezumatul…</p>
    );
  } else {
    const open = data.deals.open;
    const won = data.deals.won;
    const wonValue = data.deals.wonValue.toLocaleString('ro-RO', { maximumFractionDigits: 0 });
    const calls = data.calls.completed;
    const emails = data.emails.sent;
    body = (
      <p className="text-sm leading-relaxed text-foreground">
        În ultimele 30 de zile au fost <strong>{won}</strong> deal-uri câștigate (
        <span className="tabular-nums">{wonValue} RON</span>) și <strong>{open}</strong>{' '}
        rămase deschise. Echipa ta a avut <strong className="tabular-nums">{calls}</strong> apeluri
        finalizate și a trimis <strong className="tabular-nums">{emails}</strong> email-uri.{' '}
        <span className="text-muted-foreground">
          Rezumatul AI complet (urgențe, blocaje, recomandări) ajunge aici curând.
        </span>
      </p>
    );
  }

  return (
    <GlassCard elevation="elevated" className="mb-6 overflow-hidden p-5">
      <div className="flex items-start gap-4">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Sparkles size={16} />
        </span>
        <div className="flex-1">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Brief AI
          </p>
          {body}
        </div>
      </div>
    </GlassCard>
  );
}

interface KpiTileProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  title: string;
  value: string | number;
  sub?: string;
  href?: string;
  tone?: 'default' | 'green';
}

function KpiTile({ icon: Icon, title, value, sub, href, tone = 'default' }: KpiTileProps): JSX.Element {
  const valueClass =
    tone === 'green'
      ? 'mt-2 text-3xl font-semibold tabular-nums text-accent-green'
      : 'mt-2 text-3xl font-semibold tabular-nums';
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">{title}</span>
        <Icon size={16} className="text-muted-foreground" />
      </div>
      <p className={valueClass}>{value}</p>
      {sub && <p className="mt-1 text-xs tabular-nums text-muted-foreground">{sub}</p>}
    </>
  );
  return href ? (
    <Link to={href}>
      <GlassCard className="p-5 transition-shadow hover:shadow-glass-elev">{inner}</GlassCard>
    </Link>
  ) : (
    <GlassCard className="p-5">{inner}</GlassCard>
  );
}
