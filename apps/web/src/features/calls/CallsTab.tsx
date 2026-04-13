import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { callsApi, phoneNumbersApi } from './api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { CallStatus, SubjectType, TranscriptionStatus } from '@/lib/types';

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

/**
 * Calls tab for Company/Contact/Client detail pages.
 * Shows a click-to-call form and the call history list with status + transcript.
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
    <div className="space-y-4 pt-4">
      {!hasPhones ? (
        <p className="text-sm text-muted-foreground">
          Nu există numere de telefon configurate. Adaugă un număr Twilio via{' '}
          <code className="font-mono text-xs">/phone-numbers</code> (ADMIN).
        </p>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (toNumber.trim()) callMut.mutate();
          }}
        >
          <div className="flex-1 space-y-1">
            <Label htmlFor="call-to" className="sr-only">
              Număr destinatar
            </Label>
            <Input
              id="call-to"
              placeholder="Număr E.164 (+40712345678)"
              value={toNumber}
              onChange={(e) => setToNumber(e.target.value)}
            />
          </div>
          {callMut.isError && (
            <p className="col-span-full text-xs text-destructive">
              {callMut.error instanceof Error ? callMut.error.message : 'Eroare necunoscută'}
            </p>
          )}
          <Button
            type="submit"
            disabled={callMut.isPending || !toNumber.trim()}
          >
            {callMut.isPending ? 'Se apelează…' : 'Apelează'}
          </Button>
        </form>
      )}

      {defaultPhone && (
        <p className="text-xs text-muted-foreground">
          De la: {defaultPhone.label ?? defaultPhone.number} ({defaultPhone.number})
        </p>
      )}

      <div className="border-t pt-4">
        <h3 className="mb-2 text-sm font-medium">Istoricul apelurilor</h3>
        {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
        {calls && calls.data.length === 0 && (
          <p className="text-sm text-muted-foreground">Niciun apel înregistrat.</p>
        )}
        <ul className="divide-y">
          {calls?.data.map((call) => (
            <li key={call.id} className="space-y-1 py-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DirectionBadge direction={call.direction} />
                  <span className="text-sm font-medium">
                    {call.direction === 'OUTBOUND' ? call.toNumber : call.fromNumber}
                  </span>
                </div>
                <StatusBadge status={call.status} />
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{new Date(call.createdAt).toLocaleString('ro-RO')}</span>
                {call.durationSec != null && (
                  <span>· {formatDuration(call.durationSec)}</span>
                )}
                <TranscriptionBadge status={call.transcriptionStatus} />
              </div>
              {/* Show AI summary if available */}
              {call.transcript?.summary && (
                <p className="rounded bg-muted p-2 text-xs">{call.transcript.summary}</p>
              )}
              {/* Show action items if available */}
              {call.transcript?.actionItems && call.transcript.actionItems.length > 0 && (
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {call.transcript.actionItems.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DirectionBadge({ direction }: { direction: 'INBOUND' | 'OUTBOUND' }): JSX.Element {
  return (
    <span className={`text-xs ${direction === 'OUTBOUND' ? 'text-primary' : 'text-muted-foreground'}`}>
      {direction === 'OUTBOUND' ? '↗' : '↙'}
    </span>
  );
}

function StatusBadge({ status }: { status: CallStatus }): JSX.Element {
  const base = 'rounded-sm px-2 py-0.5 text-xs font-medium';
  const cls: Record<CallStatus, string> = {
    QUEUED:      `${base} bg-secondary text-foreground`,
    RINGING:     `${base} bg-yellow-100 text-yellow-800`,
    IN_PROGRESS: `${base} bg-blue-100 text-blue-800`,
    COMPLETED:   `${base} bg-green-100 text-green-800`,
    BUSY:        `${base} bg-orange-100 text-orange-800`,
    NO_ANSWER:   `${base} bg-orange-100 text-orange-800`,
    FAILED:      `${base} bg-destructive/10 text-destructive`,
    CANCELED:    `${base} bg-secondary text-muted-foreground`,
  };
  const labels: Record<CallStatus, string> = {
    QUEUED:      'În așteptare',
    RINGING:     'Sună',
    IN_PROGRESS: 'În curs',
    COMPLETED:   'Finalizat',
    BUSY:        'Ocupat',
    NO_ANSWER:   'Fără răspuns',
    FAILED:      'Eșuat',
    CANCELED:    'Anulat',
  };
  return <span className={cls[status]}>{labels[status]}</span>;
}

function TranscriptionBadge({ status }: { status: TranscriptionStatus }): JSX.Element | null {
  if (status === 'NONE') return null;
  const labels: Record<TranscriptionStatus, string> = {
    NONE:        '',
    PENDING:     '· Transcriere în așteptare',
    IN_PROGRESS: '· Se transcrie…',
    COMPLETED:   '· Transcris',
    FAILED:      '· Transcriere eșuată',
  };
  return <span className="text-muted-foreground">{labels[status]}</span>;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
