import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Phone } from 'lucide-react';
import { callsApi, phoneNumbersApi } from './api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CallCard, type CallCardData } from '@/components/ui/call-card';
import { GlassCard } from '@/components/ui/glass-card';
import { EmptyState } from '@/components/ui/page-header';
import type { Call, SubjectType } from '@/lib/types';

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

/**
 * Calls tab for Company/Contact/Client detail pages.
 *
 * Layout:
 *   [ click-to-call form (top) ]
 *   [ CallCard 1 — most recent ]
 *   [ CallCard 2 ]
 *   [ ... ]
 *
 * Each CallCard is the v2 voice-intelligence primitive: shows AI summary,
 * action items (with → Task buttons), expandable transcript with chat
 * bubbles, and PII redaction pills. Wraps callsApi so action items can
 * be turned into tasks inline (TODO once tasksApi.create accepts a
 * subjectType + body string in this UI flow).
 */
export function CallsTab({ subjectType, subjectId }: Props): JSX.Element {
  const qc = useQueryClient();
  const [toNumber, setToNumber] = useState('');

  const { data: phoneNumbers } = useQuery({
    queryKey: ['phone-numbers'],
    queryFn: () => phoneNumbersApi.list(),
  });

  const { data: calls, isLoading } = useQuery({
    queryKey: ['calls', { subjectType, subjectId }],
    queryFn: () => callsApi.list({ subjectType, subjectId, limit: 50 }),
  });

  const defaultPhone = phoneNumbers?.find((p) => p.isDefault) ?? phoneNumbers?.[0];

  const callMut = useMutation({
    mutationFn: () => {
      if (!defaultPhone) throw new Error('No phone number configured');
      return callsApi.initiate({ subjectType, subjectId, toNumber });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['calls'] });
      setToNumber('');
    },
  });

  const hasPhones = phoneNumbers && phoneNumbers.length > 0;

  return (
    <div className="space-y-4">
      {/* Click-to-call form */}
      {!hasPhones ? (
        <GlassCard className="px-5 py-3 text-sm text-muted-foreground">
          Nu există numere de telefon configurate. Adaugă un număr Twilio din{' '}
          <code className="rounded bg-secondary px-1 py-0.5 font-mono text-xs">/phone-numbers</code>{' '}
          (rol ADMIN).
        </GlassCard>
      ) : (
        <GlassCard className="px-5 py-3">
          <form
            className="flex items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (toNumber.trim()) callMut.mutate();
            }}
          >
            <div className="min-w-0 flex-1 space-y-1">
              <Label htmlFor="call-to" className="sr-only">
                Număr destinatar
              </Label>
              <Input
                id="call-to"
                placeholder="Număr E.164 (+40712345678)"
                value={toNumber}
                onChange={(e) => setToNumber(e.target.value)}
                className="tabular-nums"
              />
            </div>
            <Button
              type="submit"
              disabled={callMut.isPending || !toNumber.trim()}
            >
              <Phone size={14} className="mr-1.5" />
              {callMut.isPending ? 'Se apelează…' : 'Apelează'}
            </Button>
          </form>
          {defaultPhone && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              De la: <span className="font-medium">{defaultPhone.label ?? defaultPhone.number}</span>
              {' '}({defaultPhone.number})
            </p>
          )}
          {callMut.isError && (
            <p className="mt-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {callMut.error instanceof Error ? callMut.error.message : 'Eroare necunoscută'}
            </p>
          )}
        </GlassCard>
      )}

      {/* Call history */}
      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      {calls && calls.data.length === 0 && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={Phone}
            title="Niciun apel încă"
            description="Apelează numărul folosind formularul de mai sus. Apelurile vor avea transcriere automată + sumar AI după conversie."
          />
        </GlassCard>
      )}
      <div className="space-y-3">
        {calls?.data.map((call) => (
          <CallCard key={call.id} call={toCallCardData(call)} />
        ))}
      </div>
    </div>
  );
}

/**
 * Adapt the API `Call` shape to the `CallCardData` shape the primitive
 * expects. Keeping this conversion at the boundary means the primitive
 * stays product-neutral and easy to re-use on a future "all calls"
 * feed page.
 */
function toCallCardData(call: Call): CallCardData {
  const counterparty = call.direction === 'OUTBOUND' ? call.toNumber : call.fromNumber;
  const t = call.transcript;
  return {
    id: call.id,
    direction: call.direction,
    counterparty,
    startedAt: call.createdAt,
    durationSec: call.durationSec ?? null,
    status: call.status,
    transcriptionStatus: call.transcriptionStatus,
    summary: t?.summary ?? null,
    actionItems: t?.actionItems ?? undefined,
    sentiment: t?.sentiment ?? null,
    // Transcript segments not surfaced via the current API yet — the
    // CallCard renders a "Transcript" toggle only when the segments
    // array is non-empty, so this gracefully falls back to "no toggle".
    transcript: undefined,
  };
}
