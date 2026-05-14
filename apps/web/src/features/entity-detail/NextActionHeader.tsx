import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Clock, Sparkles } from 'lucide-react';
import { cockpitApi, type CockpitFeedItem } from '@/features/cockpit/api';

type EntityType = 'COMPANY' | 'CONTACT' | 'CLIENT';

interface Props {
  entityType: EntityType;
  entityId: string;
}

/**
 * Synthesized "next action" header for any entity detail page.
 *
 * Pulls the cockpit feed (already paginated and ranked server-side)
 * and surfaces the single highest-score item that links to this
 * entity. If the backend feed item carries `relatedCompanyId` /
 * `relatedContactId` / `relatedClientId`, we filter precisely;
 * otherwise we fall back to surfacing the top global action so the
 * user still sees signal.
 *
 * Three visual states:
 *  - loading: skeleton bar
 *  - healthy (no item): calm emerald "Relationship healthy"
 *  - urgent: amber/red card with score badge + deep link
 */
export function NextActionHeader({ entityType, entityId }: Props): JSX.Element {
  const feed = useQuery({
    queryKey: ['cockpit-feed-for-entity', entityType, entityId],
    queryFn: cockpitApi.feed,
    staleTime: 30_000,
  });

  const top = pickRelevant(feed.data ?? [], entityType, entityId);

  if (feed.isLoading) {
    return <div className="mb-4 h-16 animate-pulse rounded-xl border border-white/15 bg-white/[0.05]" />;
  }

  if (!top) {
    return (
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-500/40 bg-emerald-500/[0.10] px-4 py-3">
        <Sparkles className="h-5 w-5 text-emerald-300" />
        <div className="text-sm">
          <p className="font-semibold text-emerald-100">Relație în regulă</p>
          <p className="text-emerald-100/80">Niciun pas urgent acum pentru acest cont.</p>
        </div>
      </div>
    );
  }

  return (
    <Link
      to={top.href}
      className="group mb-4 flex items-center gap-3 rounded-xl border border-amber-500/50 bg-amber-500/15 px-4 py-3 transition hover:bg-amber-500/25"
    >
      <Clock className="h-5 w-5 shrink-0 text-amber-200" />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-200">Pasul următor</p>
        <p className="truncate font-semibold text-amber-50">{top.title}</p>
        {top.subtitle && (
          <p className="truncate text-sm text-amber-100/90">{top.subtitle}</p>
        )}
      </div>
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
          top.score >= 80 ? 'bg-red-500/30 text-red-100' : 'bg-amber-500/30 text-amber-50'
        }`}
      >
        {top.score}
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-amber-100 transition group-hover:text-white" />
    </Link>
  );
}

/**
 * Picks the most relevant feed item for the given entity. Prefers items
 * tagged with `relatedXxxId` matching this entity. If none match, returns
 * the top global item — better than a blank header while the backend
 * catches up to populate the related fields.
 */
function pickRelevant(
  items: CockpitFeedItem[],
  entityType: EntityType,
  entityId: string,
): CockpitFeedItem | null {
  const idField =
    entityType === 'COMPANY'
      ? 'relatedCompanyId'
      : entityType === 'CONTACT'
        ? 'relatedContactId'
        : 'relatedClientId';

  const scoped = items.find((i) => {
    const v = (i as unknown as Record<string, unknown>)[idField];
    return typeof v === 'string' && v === entityId;
  });
  if (scoped) return scoped;
  return items[0] ?? null;
}
