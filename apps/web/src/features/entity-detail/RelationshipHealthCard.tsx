import { useQuery } from '@tanstack/react-query';
import { Activity, AlertTriangle, CheckCircle2, MinusCircle, Sparkles, XCircle } from 'lucide-react';
import { api } from '@/lib/api';

type EntityType = 'COMPANY' | 'CONTACT' | 'CLIENT';

interface HealthSignal {
  key: 'recency' | 'frequency' | 'deal_momentum' | 'engagement';
  score: number;
  weight: number;
  label: string;
  hint: string;
}

interface RelationshipHealth {
  score: number;
  rating: 'excellent' | 'good' | 'fair' | 'at_risk' | 'cold';
  signals: HealthSignal[];
  summary: string;
  lastActivityAt: string | null;
  activityCount90d: number;
  openDealCount: number;
}

interface Props {
  entityType: EntityType;
  entityId: string;
}

const RATING_LABEL: Record<RelationshipHealth['rating'], string> = {
  excellent: 'Foarte bună',
  good: 'Sănătoasă',
  fair: 'Constantă',
  at_risk: 'În scădere',
  cold: 'Rece',
};

const RATING_CLASS: Record<RelationshipHealth['rating'], string> = {
  excellent: 'text-emerald-400 stroke-emerald-400',
  good: 'text-sky-400 stroke-sky-400',
  fair: 'text-amber-400 stroke-amber-400',
  at_risk: 'text-orange-400 stroke-orange-400',
  cold: 'text-rose-400 stroke-rose-400',
};

const SIGNAL_ICON: Record<HealthSignal['key'], typeof CheckCircle2> = {
  recency: CheckCircle2,
  frequency: Activity,
  deal_momentum: Sparkles,
  engagement: MinusCircle,
};

/**
 * Relationship Health card — shown on Company / Contact / Client detail pages.
 *
 * Reads from GET /entity-health/:type/:id which returns a 0-100 score,
 * deterministic per-signal breakdown, and a one-sentence Romanian summary.
 * No AI calls — all computed from existing activity + deal data.
 */
export function RelationshipHealthCard({ entityType, entityId }: Props): JSX.Element | null {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['entity-health', entityType, entityId],
    queryFn: () => api.get<RelationshipHealth>(`/entity-health/${entityType}/${entityId}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="mb-4 h-32 animate-pulse rounded-xl border border-border/60 bg-secondary/30" />
    );
  }
  if (isError || !data) return null;

  return (
    <div className="mb-4 rounded-xl border border-border/60 bg-card/60 p-5">
      <div className="flex items-start gap-5">
        <ScoreDial score={data.score} rating={data.rating} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">Stare relație</h3>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${RATING_CLASS[data.rating]} bg-current/10`}
              style={{ backgroundColor: 'rgb(from currentColor r g b / 0.12)' }}
            >
              {RATING_LABEL[data.rating]}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{data.summary}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {data.signals.map((s) => {
              const Icon = SIGNAL_ICON[s.key] ?? CheckCircle2;
              const tone =
                s.score >= 75
                  ? 'text-emerald-400'
                  : s.score >= 50
                    ? 'text-sky-400'
                    : s.score >= 25
                      ? 'text-amber-400'
                      : 'text-rose-400';
              return (
                <div
                  key={s.key}
                  className="rounded-lg border border-border/40 bg-background/40 p-2.5"
                  title={s.hint}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon size={12} className={tone} />
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {s.label}
                    </span>
                  </div>
                  <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone}`}>
                    {s.score}
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground/80">
                    {s.hint}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// 64px circular score dial built with stroke-dashoffset on an SVG circle.
function ScoreDial({
  score,
  rating,
}: {
  score: number;
  rating: RelationshipHealth['rating'];
}): JSX.Element {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const Icon = rating === 'cold' ? XCircle : rating === 'at_risk' ? AlertTriangle : CheckCircle2;

  return (
    <div className="relative h-16 w-16 shrink-0">
      <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
        <circle cx="32" cy="32" r={radius} stroke="currentColor" strokeOpacity="0.15" strokeWidth="6" fill="none" />
        <circle
          cx="32"
          cy="32"
          r={radius}
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`transition-all duration-500 ${RATING_CLASS[rating]}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-base font-bold tabular-nums ${RATING_CLASS[rating]}`}>
          {score}
        </span>
        <Icon size={10} className={RATING_CLASS[rating]} aria-hidden="true" />
      </div>
    </div>
  );
}
