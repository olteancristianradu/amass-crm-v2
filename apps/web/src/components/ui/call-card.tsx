import { useState, type ReactNode } from 'react';
import {
  CheckSquare,
  ChevronDown,
  ChevronUp,
  FileText,
  PhoneIncoming,
  PhoneOutgoing,
  Sparkles,
} from 'lucide-react';
import { GlassCard } from './glass-card';
import { StatusBadge, type StatusBadgeTone } from './page-header';
import { cn } from '@/lib/cn';

/**
 * CallCard — the differentiating UI primitive for AMASS-CRM.
 *
 * Voice intelligence is the product's main differentiator vs Pipedrive/
 * HubSpot/Zoho, but every other CRM treats the call log as just a row in
 * the activity timeline. This component flips that: each call is a
 * card, and AI summary + action items + transcript are part of it
 * inline.
 *
 *   ┌──────────────────────────────────────────────┐
 *   │ ↗ +40712… — 4:32 — 2 oct, 14:31  [completed] │ ← header
 *   │ ─── waveform divider ─────────────────────── │
 *   │ ✨ AI summary paragraph                       │ ← AI hero
 *   │   • Action item 1 → [task]                    │ ← inline → task
 *   │   • Action item 2 → [task]                    │
 *   │ ─────────────────────────────────────────── │
 *   │ [▾ Transcript]   [→ Quote]  [→ Task]          │ ← actions
 *   └──────────────────────────────────────────────┘
 *
 * When the transcript is expanded, segments render as chat bubbles —
 * the agent on the left, the customer on the right. PII redactions
 * appear as black "[REDACTED]" pills so the user knows where masking
 * was applied.
 *
 * The component is presentation-only — it expects shaped data and
 * fires callbacks for "create task", "create quote", etc. Wire it
 * to `callsApi` + `tasksApi` etc. at the call site.
 */

export interface CallTranscriptSegment {
  /** "agent" | "customer" — drives left/right alignment + styling. */
  speaker: 'agent' | 'customer' | 'unknown';
  /** Plain text of the segment (PII already redacted server-side). */
  text: string;
  /** Optional offset in seconds, shown as "01:24" lead. */
  startSec?: number;
  /** Optional sentiment tone (drives a tiny dot on the bubble). */
  tone?: StatusBadgeTone;
}

export interface CallCardData {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  /** "+40712345678" — the OTHER party (agent's side hidden — already known). */
  counterparty: string;
  /** Human label of the agent ("Anca"), optional. */
  agentLabel?: string;
  /** ISO timestamp the call started. */
  startedAt: string;
  /** Total seconds. */
  durationSec?: number | null;
  status:
    | 'QUEUED'
    | 'RINGING'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'BUSY'
    | 'NO_ANSWER'
    | 'FAILED'
    | 'CANCELED';
  transcriptionStatus: 'NONE' | 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  /** AI summary paragraph (Claude output). Optional. */
  summary?: string | null;
  /** AI-extracted action items. Each item maps to a "→ task" CTA. */
  actionItems?: string[];
  /** Optional sentiment label / score from AI. */
  sentiment?: string | null;
  /** Transcript segments (already redacted server-side). */
  transcript?: CallTranscriptSegment[];
}

export interface CallCardProps {
  call: CallCardData;
  /** Called when user clicks "→ Task" on a specific action item.
   *  Use it to prefill a task form with the item text. */
  onCreateTask?: (item: string) => void;
  /** Called for "→ Quote" CTA — prefill a quote with the call as context. */
  onCreateQuote?: () => void;
  /** Called for "Replay" / play recording. Optional; rendered as a play
   *  glyph in the header when supplied. */
  onPlay?: () => void;
}

export function CallCard({
  call,
  onCreateTask,
  onCreateQuote,
  onPlay,
}: CallCardProps): JSX.Element {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const inbound = call.direction === 'INBOUND';
  const Direction = inbound ? PhoneIncoming : PhoneOutgoing;
  const directionLabel = inbound ? 'Apel intrat' : 'Apel ieșit';

  const hasAi =
    call.transcriptionStatus === 'COMPLETED' &&
    (call.summary || (call.actionItems && call.actionItems.length > 0));
  const hasTranscript = call.transcript && call.transcript.length > 0;

  return (
    <GlassCard className="overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
            inbound ? 'bg-accent-blue/15 text-accent-blue' : 'bg-accent-green/15 text-accent-green',
          )}
          title={directionLabel}
          aria-label={directionLabel}
        >
          <Direction size={14} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium tabular-nums">{call.counterparty}</p>
          <p className="text-xs tabular-nums text-muted-foreground">
            {new Date(call.startedAt).toLocaleString('ro-RO')}
            {call.durationSec != null && ` · ${formatDuration(call.durationSec)}`}
            {call.agentLabel && ` · ${call.agentLabel}`}
          </p>
        </div>
        <CallStatusBadge status={call.status} />
        {call.transcriptionStatus !== 'NONE' && call.transcriptionStatus !== 'COMPLETED' && (
          <TranscriptionInProgress status={call.transcriptionStatus} />
        )}
        {onPlay && (
          <button
            type="button"
            onClick={onPlay}
            className="rounded-full border border-border/70 bg-card/70 p-1.5 text-foreground hover:bg-card"
            title="Redă înregistrarea"
            aria-label="Redă înregistrarea"
          >
            ▶
          </button>
        )}
      </div>

      {/* Waveform divider — purely decorative, hints at audio without
          actually rendering the real waveform. Real waveform is a
          larger component for a future "call detail" page. */}
      <div className="px-5">
        <Waveform />
      </div>

      {/* AI block */}
      {hasAi && (
        <div className="space-y-3 px-5 py-4">
          {call.summary && (
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                <Sparkles size={12} />
              </span>
              <div className="min-w-0">
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Sumar AI
                </p>
                <p className="text-sm leading-relaxed">{call.summary}</p>
                {call.sentiment && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Ton: <span className="font-medium">{call.sentiment}</span>
                  </p>
                )}
              </div>
            </div>
          )}
          {call.actionItems && call.actionItems.length > 0 && (
            <div>
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Acțiuni propuse
              </p>
              <ul className="space-y-1.5">
                {call.actionItems.map((item, i) => (
                  <li
                    key={i}
                    className="group flex items-start gap-2 rounded-md border border-border/40 bg-secondary/30 px-3 py-1.5 text-sm"
                  >
                    <CheckSquare
                      size={14}
                      className="mt-0.5 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1">{item}</span>
                    {onCreateTask && (
                      <button
                        type="button"
                        onClick={() => onCreateTask(item)}
                        className="shrink-0 rounded-md border border-border/70 bg-card/80 px-2 py-0.5 text-xs hover:bg-card"
                      >
                        → Task
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Empty AI state when transcription completed but Claude returned nothing */}
      {!hasAi && call.transcriptionStatus === 'COMPLETED' && (
        <p className="px-5 py-3 text-xs text-muted-foreground">
          Transcriere finalizată; AI nu a extras un sumar (apel scurt sau audio neclar).
        </p>
      )}

      {/* Footer actions */}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border/40 bg-secondary/20 px-5 py-2.5">
        <div className="flex flex-wrap items-center gap-1">
          {hasTranscript && (
            <button
              type="button"
              onClick={() => setTranscriptOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              <FileText size={12} />
              Transcript
              {transcriptOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {onCreateQuote && (
            <button
              type="button"
              onClick={onCreateQuote}
              className="rounded-md border border-border/70 bg-card/80 px-2 py-1 text-xs hover:bg-card"
            >
              → Ofertă
            </button>
          )}
        </div>
      </footer>

      {/* Expandable transcript */}
      {transcriptOpen && hasTranscript && (
        <div className="space-y-2 border-t border-border/40 bg-card/30 px-5 py-4">
          {call.transcript!.map((seg, i) => (
            <TranscriptBubble key={i} seg={seg} />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function Waveform(): JSX.Element {
  // Decorative, deterministic 40-bar waveform built with HTML so it
  // scales with text and doesn't pull in an SVG library. Real waveform
  // visualisation lives on the future "call detail" full-screen player.
  const heights = [
    18, 35, 22, 60, 40, 15, 80, 55, 28, 70, 30, 45, 68, 22, 95, 40, 24, 82, 50, 30,
    72, 18, 55, 38, 88, 25, 60, 42, 70, 30, 18, 50, 35, 78, 22, 45, 62, 30, 55, 18,
  ];
  return (
    <div className="flex h-6 items-center gap-0.5 opacity-50" aria-hidden>
      {heights.map((h, i) => (
        <span
          key={i}
          className="block w-0.5 rounded-full bg-foreground/30"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

function TranscriptBubble({ seg }: { seg: CallTranscriptSegment }): JSX.Element {
  const isAgent = seg.speaker === 'agent';
  return (
    <div className={cn('flex', isAgent ? 'justify-start' : 'justify-end')}>
      <div className={cn('max-w-[82%] space-y-0.5', isAgent ? 'mr-auto' : 'ml-auto')}>
        <div className="flex items-baseline gap-2 text-[10px] tabular-nums text-muted-foreground">
          <span>{labelForSpeaker(seg.speaker)}</span>
          {seg.startSec != null && <span>{formatDuration(seg.startSec)}</span>}
        </div>
        <p
          className={cn(
            'rounded-2xl px-3 py-2 text-sm leading-snug',
            isAgent
              ? 'rounded-bl-sm bg-secondary text-foreground'
              : 'rounded-br-sm bg-primary text-primary-foreground',
          )}
        >
          {renderRedactions(seg.text)}
        </p>
      </div>
    </div>
  );
}

/**
 * Render `[CNP_REDACTAT]`, `[EMAIL_REDACTAT]`, etc. as a small black
 * pill so PII redactions are visible without exposing the underlying
 * data. Server already redacted; this is purely visual.
 */
function renderRedactions(text: string): ReactNode {
  const parts = text.split(/(\[[A-Z_]+_REDACTAT\])/g);
  return parts.map((p, i) => {
    if (/^\[[A-Z_]+_REDACTAT\]$/.test(p)) {
      return (
        <span
          key={i}
          className="mx-0.5 inline-block rounded bg-black px-1.5 py-0 text-[10px] font-medium uppercase tracking-wide text-white"
        >
          {p.slice(1, -1).replace('_REDACTAT', '')}
        </span>
      );
    }
    return p;
  });
}

function labelForSpeaker(s: CallTranscriptSegment['speaker']): string {
  if (s === 'agent') return 'Agent';
  if (s === 'customer') return 'Client';
  return 'Vorbitor';
}

function CallStatusBadge({ status }: { status: CallCardData['status'] }): JSX.Element {
  const tones: Record<CallCardData['status'], StatusBadgeTone> = {
    QUEUED: 'neutral',
    RINGING: 'amber',
    IN_PROGRESS: 'blue',
    COMPLETED: 'green',
    BUSY: 'amber',
    NO_ANSWER: 'amber',
    FAILED: 'pink',
    CANCELED: 'neutral',
  };
  const labels: Record<CallCardData['status'], string> = {
    QUEUED: 'În așteptare',
    RINGING: 'Sună',
    IN_PROGRESS: 'În curs',
    COMPLETED: 'Finalizat',
    BUSY: 'Ocupat',
    NO_ANSWER: 'Fără răspuns',
    FAILED: 'Eșuat',
    CANCELED: 'Anulat',
  };
  return <StatusBadge tone={tones[status]}>{labels[status]}</StatusBadge>;
}

function TranscriptionInProgress({
  status,
}: {
  status: 'PENDING' | 'IN_PROGRESS' | 'FAILED';
}): JSX.Element {
  const labels: Record<typeof status, string> = {
    PENDING: 'Transcriere în așteptare',
    IN_PROGRESS: 'Se transcrie…',
    FAILED: 'Transcriere eșuată',
  };
  const tone: StatusBadgeTone = status === 'FAILED' ? 'pink' : 'neutral';
  return <StatusBadge tone={tone}>{labels[status]}</StatusBadge>;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
