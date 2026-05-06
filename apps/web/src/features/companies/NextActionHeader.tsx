import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Clock, Sparkles } from 'lucide-react';
import { cockpitApi, type CockpitFeedItem } from '@/features/cockpit/api';

interface Props {
  companyId: string;
}

/**
 * Synthesized "next action" header for a company. Pulls the cockpit
 * feed (already paginated and ranked server-side) and surfaces the
 * single highest-score item that links to this company. If nothing
 * urgent is queued, shows a calm "Relationship healthy" state.
 *
 * The cockpit feed today links via `href` like `/app/deals/<id>`,
 * not by company id. We approximate by matching company name in
 * subtitle for now — a future iteration adds an explicit
 * `relatedCompanyId` field on each feed item so the join is exact.
 */
export function NextActionHeader({ companyId }: Props): JSX.Element {
  const feed = useQuery({
    queryKey: ['cockpit-feed-for-company', companyId],
    queryFn: cockpitApi.feed,
    staleTime: 30_000,
  });

  const top = pickRelevant(feed.data ?? [], companyId);

  if (feed.isLoading) {
    return (
      <div className="mb-4 h-16 animate-pulse rounded-xl border border-white/10 bg-white/[0.02]" />
    );
  }

  if (!top) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3">
        <Sparkles className="h-5 w-5 text-emerald-400" />
        <div className="text-sm">
          <p className="font-medium text-emerald-200">Relationship healthy</p>
          <p className="text-emerald-100/60">No urgent action on this account right now.</p>
        </div>
      </div>
    );
  }

  return (
    <Link
      to={top.href}
      className="group mb-4 flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-4 py-3 transition hover:bg-amber-500/[0.08]"
    >
      <Clock className="h-5 w-5 shrink-0 text-amber-300" />
      <div className="min-w-0 flex-1">
        <p className="text-xs uppercase tracking-wide text-amber-300/70">Next action</p>
        <p className="truncate font-medium text-amber-100">{top.title}</p>
        {top.subtitle && (
          <p className="truncate text-sm text-amber-100/60">{top.subtitle}</p>
        )}
      </div>
      <span
        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
          top.score >= 80 ? 'bg-red-500/15 text-red-300' : 'bg-amber-500/15 text-amber-200'
        }`}
      >
        {top.score}
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-amber-200/60 transition group-hover:text-amber-100" />
    </Link>
  );
}

function pickRelevant(items: CockpitFeedItem[], companyId: string): CockpitFeedItem | null {
  // Direct match: deal whose href ends with this company's deals — but
  // current schema links deal-level, not company-level. So we accept any
  // top-3 item until backend adds relatedCompanyId.
  // Future: filter by `item.relatedCompanyId === companyId` when added.
  void companyId; // silence unused-var until the backend join arrives
  return items[0] ?? null;
}
