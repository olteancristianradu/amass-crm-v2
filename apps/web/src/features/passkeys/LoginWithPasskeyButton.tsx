import * as React from 'react';
import { useRouter } from '@tanstack/react-router';
import {
  browserSupportsWebAuthn,
  startAuthentication,
} from '@simplewebauthn/browser';
import { Fingerprint, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiError } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { passkeysApi } from './api';

/**
 * B2-PR4 — log in using a registered passkey (Face ID / Touch ID /
 * Windows Hello / YubiKey).
 *
 * Ceremony (mirrors RegisterPasskeyButton's phase machine):
 *   1. `requesting-options` — POST /webauthn/authenticate/options with the
 *      email the user typed. BE resolves the tenant + returns options +
 *      a session-binding userId hint.
 *   2. `awaiting-authenticator` — browser native sheet pops; user touches
 *      the authenticator. Can be cancelled (NotAllowedError / AbortError).
 *   3. `verifying` — POST /webauthn/authenticate/verify with the signed
 *      assertion. On success, BE mints the same `{ user, tokens }`
 *      envelope as /auth/login.
 *   4. `idle` — tokens applied, router navigates to /app.
 *
 * Why a separate FE component (vs. a flag inside LoginForm): the password
 * flow has its own complex states (TOTP step, tenant picker, validation).
 * Cramming WebAuthn into that flow would balloon LoginForm — instead this
 * component renders ABOVE the form on /login and pipes the same auth
 * store call (`setSession`) on success, so the post-login UX is identical.
 *
 * If `browserSupportsWebAuthn()` returns false (older browser, missing
 * Platform Authenticator API) the component renders NOTHING — the login
 * page falls back to the password form only. This matches B2-PR4's
 * pitfall note: don't show a disabled control, just hide.
 */

type Phase =
  | 'idle'
  | 'requesting-options'
  | 'awaiting-authenticator'
  | 'verifying';

/** Romanian, user-facing copy. Logs stay in English. */
const MESSAGES = {
  cancelled: 'Anulat',
  unsupported: 'Browser-ul nu suportă passkeys — folosește parola',
  noPasskey: 'Nu există un passkey înregistrat pentru acest email',
  generic: 'Eroare. Încearcă din nou sau folosește parola.',
} as const;

/**
 * Translate any thrown error from the ceremony into Romanian user copy.
 *
 * We discriminate on:
 *   - DOMException NotAllowedError / AbortError → user cancelled or
 *     timed out at the authenticator sheet. Same UX either way.
 *   - ApiError code === INVALID_CREDENTIALS → BE refused (no user, no
 *     passkey, wrong tenant, signature failed). Surface a generic
 *     phrasing that does NOT leak whether the email exists.
 *   - Anything else → fall back to a generic Romanian message rather
 *     than expose a technical string to the user.
 */
function describeError(err: unknown): string {
  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
      return MESSAGES.cancelled;
    }
  }
  if (err instanceof ApiError) {
    if (err.code === 'INVALID_CREDENTIALS') return MESSAGES.noPasskey;
  }
  return MESSAGES.generic;
}

export interface LoginWithPasskeyButtonProps {
  /**
   * If the parent already collects the email (typical case on /login), it
   * can pass it down to skip the inline email field. When omitted, this
   * component renders its own minimal email input so it stays usable on
   * its own (e.g. on a "Sign in with passkey" landing).
   */
  email?: string;
  /** Optional tenantSlug — only needed when the email lives on >1 tenant. */
  tenantSlug?: string;
}

export function LoginWithPasskeyButton({
  email: emailProp,
  tenantSlug,
}: LoginWithPasskeyButtonProps = {}): JSX.Element | null {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [internalEmail, setInternalEmail] = React.useState('');
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [error, setError] = React.useState<string | null>(null);

  // Pin support check at mount — same pattern as RegisterPasskeyButton.
  // SSR-safe via the library's window guard.
  const supported = React.useMemo(() => browserSupportsWebAuthn(), []);

  // Render NOTHING when the browser can't do WebAuthn. The login page
  // already has a fully-working password form right beneath us; showing
  // a disabled button would just clutter the UX.
  if (!supported) return null;

  const email = (emailProp ?? internalEmail).trim();
  const canSubmit = email.length > 0 && phase === 'idle';

  async function runCeremony(): Promise<void> {
    setError(null);
    try {
      // 1) BE: resolve user + return options + userId session-binding hint
      setPhase('requesting-options');
      const { options, userId } = await passkeysApi.authenticateOptions(
        email,
        tenantSlug,
      );

      // 2) Browser: prompt the user's authenticator. The library's
      //    startAuthentication wraps navigator.credentials.get().
      setPhase('awaiting-authenticator');
      const assertion = await startAuthentication({ optionsJSON: options });

      // 3) BE: verify signature + mint tokens. Same envelope shape as
      //    /auth/login — we feed it straight into the auth store.
      setPhase('verifying');
      const { user, tokens } = await passkeysApi.authenticateVerify(
        userId,
        assertion,
      );

      setSession(user, tokens);
      setPhase('idle');
      await router.navigate({ to: '/app' });
    } catch (err) {
      setPhase('idle');
      setError(describeError(err));
    }
  }

  // Each phase has a distinct label so the user can see exactly what's
  // happening — especially while the OS-level authenticator sheet is open
  // (the button beneath stays informative instead of dead).
  const phaseLabel: Record<Phase, string> = {
    idle: 'Conectare cu passkey',
    'requesting-options': 'Se pregătește…',
    'awaiting-authenticator': 'Confirmă pe dispozitiv…',
    verifying: 'Se verifică…',
  };

  const inFlight = phase !== 'idle';

  return (
    <div className="space-y-3" data-testid="login-with-passkey">
      {emailProp === undefined && (
        <div className="space-y-1.5">
          <Label htmlFor="passkey-login-email">Email</Label>
          <Input
            id="passkey-login-email"
            type="email"
            autoComplete="username webauthn"
            placeholder="nume@firma.ro"
            value={internalEmail}
            onChange={(e) => setInternalEmail(e.target.value)}
            disabled={inFlight}
          />
        </div>
      )}

      <Button
        type="button"
        onClick={() => {
          void runCeremony();
        }}
        disabled={!canSubmit}
        aria-busy={inFlight}
        className="w-full gap-2"
        variant="outline"
      >
        {inFlight ? (
          <Loader2 size={16} className="animate-spin" aria-hidden />
        ) : (
          <Fingerprint size={16} aria-hidden />
        )}
        {phaseLabel[phase]}
      </Button>

      {error && (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="passkey-login-error"
        >
          {error}
        </p>
      )}
    </div>
  );
}
