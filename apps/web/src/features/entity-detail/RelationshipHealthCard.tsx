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

// Theme-aware tone classes — kept light/dark agnostic by mixing emerald
// with a transparent overlay. Tailwind's emerald-600 sits well on both
// bg-card light (white) and bg-card dark (slate-900).
const RATING_TONE: Record<RelationshipHealth['rating'], { text: string; ring: string; bg: string }> = {
  excellent: { text: 'text-emerald-600 dark:text-emerald-400', ring: 'stroke-emerald-500',  bg: 'bg-emerald-500/10' },
  good:      { text: 'text-sky-600     dark:text-sky-400',     ring: 'stroke-sky-500',      bg: 'bg-sky-500/10' },
  fair:      { text: 'text-amber-600   dark:text-amber-400',   ring: 'stroke-amber-500',    bg: 'bg-amber-500/10' },
  at_risk:   { text: 'text-orange-600  dark:text-orange-400',  ring: 'stroke-orange-500',   bg: 'bg-orange-500/10' },
  cold:      { text: 'text-rose-600    dark:text-rose-400',    ring: 'stroke-rose-500',     bg: 'bg-rose-500/10' },
};

const SIGNAL_ICON: Record<HealthSignal['key'], typeof CheckCircle2> = {
  recency: CheckCircle2,
  frequency: Activity,
  deal_momentum: Sparkles,
  engagement: MinusCircle,
};

/**
 * Relationship Health card — shown in the sidebar of every detail page.
 *
 * Solid `bg-card` surface, big colored score dial on the left, summary +
 * signal scores stacked on the right. Designed to read at a glance: the
 * dial's stroke arc is the headline, every other element supports it.
 */
export function RelationshipHealthCard({ entityType, entityId }: Props): JSX.Element | null {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['entity-health', entityType, entityId],
    queryFn: () => api.get<RelationshipHealth>(`/entity-health/${entityType}/${entityId}`),
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="h-44 animate-pulse rounded-xl border border-border bg-card" />;
  }
  if (isError || !data) return null;

  const tone = RATING_TONE[data.rating];

  return (
    <section className="rounded-xl border border-border bg-card text-card-foreground shadow-sm">
      <header className="flex items-center gap-4 px-4 pt-4">
        <ScoreDial score={data.score} rating={data.rating} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground">Stare relație</p>
          <p className={`mt-0.5 text-base font-semibold ${tone.text}`}>{RATING_LABEL[data.rating]}</p>
        </div>
      </header>
      <p className="px-4 pt-2 text-sm leading-snug text-muted-foreground">{data.summary}</p>
      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-b-xl bg-border/60">
        {data.signals.map((s) => {
          const Icon = SIGNAL_ICON[s.key] ?? CheckCircle2;
          const sigTone =
            s.score >= 75
              ? 'text-emerald-600 dark:text-emerald-400'
              : s.score >= 50
                ? 'text-sky-600 dark:text-sky-400'
                : s.score >= 25
                  ? 'text-amber-600 dark:text-amber-400'
                  : 'text-rose-600 dark:text-rose-400';
          return (
            <div
              key={s.key}
              className="flex items-center justify-between gap-2 bg-card px-3 py-2"
              title={s.hint}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <Icon size={13} className={sigTone} />
                <span className="truncate text-xs text-muted-foreground">{s.label}</span>
              </div>
              <span className={`text-sm font-semibold tabular-nums ${sigTone}`}>{s.score}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// 72px circular score dial with a thicker stroke than before so the arc
// reads at a glance against the now-solid card background.
function ScoreDial({
  score,
  rating,
}: {
  score: number;
  rating: RelationshipHealth['rating'];
}): JSX.Element {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const Icon = rating === 'cold' ? XCircle : rating === 'at_risk' ? AlertTriangle : CheckCircle2;
  const tone = RATING_TONE[rating];

  return (
    <div className="relative h-[72px] w-[72px] shrink-0">
      <svg viewBox="0 0 72 72" className="h-full w-full -rotate-90">
        <circle cx="36" cy="36" r={radius} className="stroke-border" strokeWidth="7" fill="none" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          strokeWidth="7"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={`${tone.ring} transition-all duration-500`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-xl font-bold tabular-nums leading-none ${tone.text}`}>{score}</span>
        <Icon size={11} className={`${tone.text} mt-0.5`} aria-hidden="true" />
      </div>
    </div>
  );
}
