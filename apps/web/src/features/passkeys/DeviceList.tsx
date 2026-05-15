import * as React from 'react';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { KeyRound, Loader2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api';
import { toast } from '@/stores/toasts';
import { passkeysApi, passkeysQueryKey, type PasskeyDevice } from './api';

/**
 * B2-PR4 — list the user's registered passkeys + provide a revoke action
 * per row.
 *
 * Data source: React Query keyed on `passkeysQueryKey`, the same key
 * RegisterPasskeyButton invalidates on a successful registration. That
 * means: register a passkey on the same page → list refetches → new row
 * appears automatically, no extra wiring.
 *
 * Revoke flow:
 *   1. Click the trash icon → `window.confirm` (matches the project's
 *      existing confirm pattern, e.g. SavedViewsDropdown.delete).
 *   2. On confirm → useMutation calls passkeysApi.revoke(id) →
 *      invalidate the list query → toast in Romanian.
 *
 * UI structure:
 *   - Loading state: a row of skeleton placeholders (so the section
 *     reserves space and avoids layout shift when data arrives).
 *   - Empty state: explanatory Romanian copy pointing at the register
 *     button right above.
 *   - Populated: a stack of cards with device name, transports as
 *     badges, "X zile în urmă" relative timestamps, revoke button.
 *
 * The wrapper carries `data-tour="settings-security-devices"` — the
 * Settings page used the same anchor for its placeholder slot, so the
 * tour script keeps working.
 */

const TRANSPORT_LABELS: Record<string, string> = {
  internal: 'Built-in',
  usb: 'USB',
  ble: 'Bluetooth',
  nfc: 'NFC',
  hybrid: 'QR',
  smartcard: 'Smartcard',
};

/**
 * Relative time in Romanian. Uses Intl.RelativeTimeFormat (built-in to
 * V8 — no extra dep). Buckets: days / hours / minutes / "acum".
 *
 * We round towards the most-significant bucket so "5 zile în urmă" is
 * preferred over "120 ore în urmă". For absolute precision the row also
 * has the full date in a title attribute.
 */
function formatRelative(dateStr: string | null): string {
  if (!dateStr) return 'Niciodată';
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = date.getTime() - now; // negative = past
  const rtf = new Intl.RelativeTimeFormat('ro', { numeric: 'auto' });

  const minutes = Math.round(diffMs / 60_000);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(diffMs / 3_600_000);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(diffMs / 86_400_000);
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  const months = Math.round(diffMs / (86_400_000 * 30));
  if (Math.abs(months) < 12) return rtf.format(months, 'month');
  const years = Math.round(diffMs / (86_400_000 * 365));
  return rtf.format(years, 'year');
}

function TransportBadge({ transport }: { transport: string }): JSX.Element {
  const label = TRANSPORT_LABELS[transport] ?? transport.toUpperCase();
  return (
    <span className="inline-flex items-center rounded-md border border-border bg-secondary/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      {label}
    </span>
  );
}

function DeviceRow({
  device,
  onRevoke,
  revoking,
}: {
  device: PasskeyDevice;
  onRevoke: (id: string) => void;
  revoking: boolean;
}): JSX.Element {
  const displayName = device.deviceName || 'Device necunoscut';
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-4 py-3"
      data-testid="passkey-device-row"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
        <KeyRound size={14} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{displayName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {(device.transports.length > 0 ? device.transports : ['—']).map((t) => (
            <TransportBadge key={t} transport={t} />
          ))}
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Înregistrat <time title={device.createdAt}>{formatRelative(device.createdAt)}</time>
          {' · '}
          Folosit ultima dată <span>{formatRelative(device.lastUsedAt)}</span>
        </p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => onRevoke(device.id)}
        disabled={revoking}
        aria-label={`Revocă ${displayName}`}
        className="gap-1"
      >
        {revoking ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <Trash2 size={14} aria-hidden />
        )}
        Revocă
      </Button>
    </div>
  );
}

export function DeviceList(): JSX.Element {
  const qc = useQueryClient();
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: passkeysQueryKey,
    queryFn: () => passkeysApi.list(),
    // Devices are stable user state — no need to refetch every focus.
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (passkeyId: string) => passkeysApi.revoke(passkeyId),
    onMutate: (id) => {
      setPendingId(id);
    },
    onSuccess: () => {
      toast('Passkey revocat ✓');
      void qc.invalidateQueries({ queryKey: passkeysQueryKey });
    },
    onError: (err) => {
      const msg =
        err instanceof ApiError && err.code !== `HTTP_${err.status}`
          ? err.message
          : 'Nu am putut revoca passkey-ul. Reîncearcă.';
      toast(msg);
    },
    onSettled: () => {
      setPendingId(null);
    },
  });

  function handleRevoke(id: string): void {
    // Match the project's existing confirm pattern (SavedViewsDropdown).
    // A custom modal could come later — current scope is one-shot ops.
    if (!window.confirm('Sigur dezactivezi acest passkey?')) return;
    mutation.mutate(id);
  }

  return (
    <div data-tour="settings-security-devices" className="space-y-3">
      {query.isLoading && (
        // Skeleton rows — same height + structure as real rows so there's
        // no layout shift when data hydrates.
        <div className="space-y-2" data-testid="passkey-list-loading">
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-16 animate-pulse rounded-md border border-border bg-secondary/30"
            />
          ))}
        </div>
      )}

      {query.isError && (
        <p role="alert" className="text-sm text-destructive">
          Nu am putut încărca lista. Reîncarcă pagina.
        </p>
      )}

      {query.isSuccess && query.data.length === 0 && (
        <div className="rounded-md border border-dashed border-border/70 bg-secondary/30 p-6 text-center">
          <p className="text-sm font-medium">
            Nu ai niciun passkey înregistrat.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Folosește butonul de mai sus pentru a începe.
          </p>
        </div>
      )}

      {query.isSuccess && query.data.length > 0 && (
        <div className="space-y-2">
          {query.data.map((d) => (
            <DeviceRow
              key={d.id}
              device={d}
              onRevoke={handleRevoke}
              revoking={pendingId === d.id && mutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}
