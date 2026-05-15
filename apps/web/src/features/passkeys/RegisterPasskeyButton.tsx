import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  browserSupportsWebAuthn,
  startRegistration,
} from '@simplewebauthn/browser';
import { KeyRound, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { toast } from '@/stores/toasts';
import { passkeysApi, passkeysQueryKey } from './api';

/**
 * B2-PR3 — register a new passkey for the currently authenticated user.
 *
 * Flow (each step is a labeled mutation phase so the UI can show what's
 * happening — see `phase` state):
 *   1. `requesting-options` — POST /webauthn/register/options
 *   2. `awaiting-authenticator` — browser native sheet (Face ID / Touch ID
 *      / Windows Hello / YubiKey). The user can cancel here, which throws
 *      a DOMException we translate to a Romanian message.
 *   3. `verifying` — POST /webauthn/register/verify with the attestation
 *   4. `idle` — clear, ready for another registration
 *
 * The optional `deviceName` lets the user label this credential ("MacBook
 * Pro at home", "iPhone", "YubiKey 5C"). Stored on the BE Passkey row for
 * the future device list (B2-PR4).
 *
 * On success the React Query cache for `passkeysQueryKey` is invalidated
 * so the device list (rendered by B2-PR4 in the same Settings page) picks
 * up the new row. Until B2-PR4 the list endpoint 404s and `passkeysApi.list`
 * returns []; the invalidation is harmless in that case.
 */

type Phase =
  | 'idle'
  | 'requesting-options'
  | 'awaiting-authenticator'
  | 'verifying';

/** Romanian, user-facing copy. Internal codes stay in English in logs. */
const MESSAGES = {
  cancelled: 'Anulat — poți reîncerca oricând',
  unsupported: 'Browser-ul nu suportă passkeys',
  network: 'Eroare de rețea — verifică conexiunea',
  generic: 'Nu am putut înregistra passkey-ul. Reîncearcă.',
  success: 'Passkey înregistrat ✓',
} as const;

/**
 * Translate a thrown error into Romanian user copy. We discriminate on:
 *  - DOMException name === "NotAllowedError" / "AbortError" → user cancelled
 *    or the authenticator timed out. Same UX either way.
 *  - DOMException name === "NotSupportedError" → algorithm mismatch, treat
 *    as "browser not supported" for messaging purposes.
 *  - TypeError → typically a fetch network failure (DNS, offline, CORS).
 *  - ApiError → comes from the shared api wrapper; we still pull a friendly
 *    message but fall back to MESSAGES.generic if it's just an HTTP code.
 */
function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
      return MESSAGES.cancelled;
    }
    if (err.name === 'NotSupportedError') {
      return MESSAGES.unsupported;
    }
  }
  if (err instanceof TypeError) {
    return MESSAGES.network;
  }
  if (err instanceof ApiError) {
    // ApiError.message is already friendly when a code maps via
    // FRIENDLY_MESSAGES; otherwise it's something like "HTTP 500" — swap
    // for the generic copy so we never expose technical text.
    if (err.message.startsWith('HTTP ')) return MESSAGES.generic;
    return err.message;
  }
  return MESSAGES.generic;
}

export interface RegisterPasskeyButtonProps {
  /** Override the default button label (used in tests / a/b). */
  label?: string;
  /** Hide the device-name input when embedding inside a custom layout. */
  hideDeviceNameInput?: boolean;
}

export function RegisterPasskeyButton({
  label = 'Înregistrează passkey',
  hideDeviceNameInput = false,
}: RegisterPasskeyButtonProps = {}): JSX.Element {
  const qc = useQueryClient();
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const [deviceName, setDeviceName] = React.useState('');

  // Pin the support check at mount. browserSupportsWebAuthn() reads
  // `window.PublicKeyCredential` — cheap, but no point re-running it on
  // every render. SSR-safe: @simplewebauthn/browser short-circuits to
  // `false` when `window` is missing.
  const supported = React.useMemo(() => browserSupportsWebAuthn(), []);

  const mutation = useMutation({
    mutationFn: async (name: string | undefined) => {
      setError(null);

      // 1) Ask server for options
      setPhase('requesting-options');
      const optionsJSON = await passkeysApi.registerOptions();

      // 2) Hand off to the platform authenticator. The library calls
      //    navigator.credentials.create() under the hood.
      setPhase('awaiting-authenticator');
      const attResp = await startRegistration({ optionsJSON });

      // 3) Send attestation to the server for verification + persistence
      setPhase('verifying');
      const result = await passkeysApi.registerVerify(attResp, name);
      return result;
    },
    onSuccess: () => {
      setPhase('idle');
      setDeviceName('');
      toast(MESSAGES.success);
      // Refresh the device list query. Until B2-PR4 wires GET /webauthn/devices
      // this just refetches an empty list — harmless, and keeps the wiring
      // ready for the moment the BE endpoint goes live.
      void qc.invalidateQueries({ queryKey: passkeysQueryKey });
    },
    onError: (err) => {
      setPhase('idle');
      setError(describeError(err));
    },
  });

  const inFlight = phase !== 'idle';

  // Disable + label-swap matrix. Each phase has its own label so the user
  // can see exactly what step is running (especially useful while the OS
  // authenticator sheet is open — the button beneath stays informative).
  const phaseLabel: Record<Phase, string> = {
    idle: label,
    'requesting-options': 'Se pregătește…',
    'awaiting-authenticator': 'Confirmă pe dispozitiv…',
    verifying: 'Se verifică…',
  };

  if (!supported) {
    // No need for a click target — passkey registration just isn't possible
    // here. Tell the user why and link to docs (future work) so they don't
    // think the feature is broken.
    return (
      <div className="rounded-md border border-dashed border-border/70 bg-secondary/40 p-4 text-sm">
        <p className="font-medium">{MESSAGES.unsupported}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Folosește un browser modern (Chrome, Safari, Edge, Firefox actualizate) pe un dispozitiv cu Face ID, Touch ID, Windows Hello sau o cheie de securitate.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!hideDeviceNameInput && (
        <div className="space-y-1.5">
          <label
            htmlFor="passkey-device-name"
            className="text-xs font-medium text-muted-foreground"
          >
            Nume dispozitiv (opțional)
          </label>
          <Input
            id="passkey-device-name"
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="MacBook Pro at home"
            maxLength={120}
            disabled={inFlight}
            autoComplete="off"
          />
          <p className="text-[11px] text-muted-foreground/80">
            Te ajută să recunoști dispozitivul în lista de passkey-uri.
          </p>
        </div>
      )}

      <Button
        type="button"
        onClick={() => mutation.mutate(deviceName.trim() || undefined)}
        disabled={inFlight}
        aria-busy={inFlight}
        className="gap-2"
      >
        {inFlight ? (
          <Loader2 size={16} className="animate-spin" aria-hidden />
        ) : (
          <KeyRound size={16} aria-hidden />
        )}
        {phaseLabel[phase]}
      </Button>

      {error && (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="passkey-register-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
