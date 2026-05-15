import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { api } from '@/lib/api';
import type { AuthTokens, AuthUser } from '@/stores/auth';

/**
 * B2-PR3 + B2-PR4 — Frontend API wrapper for the passkey (WebAuthn) endpoints.
 *
 * Mirrors `apps/api/src/modules/webauthn/webauthn.controller.ts`. The auth
 * header is added by the shared `api` client, which reads the access token
 * from the auth store on every request.
 *
 * Register ceremony (B2-PR3):
 *   1. POST /webauthn/register/options  → server returns options JSON
 *   2. browser → navigator.credentials.create() via @simplewebauthn/browser
 *   3. POST /webauthn/register/verify   → server persists Passkey row
 *
 * Authenticate ceremony (B2-PR4):
 *   1. POST /webauthn/authenticate/options → request options + userId hint
 *   2. browser → navigator.credentials.get() via @simplewebauthn/browser
 *   3. POST /webauthn/authenticate/verify  → mint { user, tokens } envelope
 *
 * Device management (B2-PR4):
 *   - GET /webauthn/devices         → list user's passkeys
 *   - DELETE /webauthn/devices/:id  → revoke a single passkey (204)
 */

export interface RegisterVerifyResult {
  passkeyId: string;
  /** The server returns the WebAuthn credentialId (base64url). */
  credentialId: string;
}

export interface PasskeyDevice {
  id: string;
  credentialId: string;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  transports: string[];
}

/** Response from POST /webauthn/authenticate/options. */
export interface AuthenticateOptionsResponse {
  options: PublicKeyCredentialRequestOptionsJSON;
  /** Session-binding hint — must be echoed back on /verify (see service comment). */
  userId: string;
}

/** Response from POST /webauthn/authenticate/verify (same shape as /auth/login). */
export interface AuthenticateVerifyResult {
  user: AuthUser;
  tokens: AuthTokens;
}

/** React Query key for the user's passkey device list. Exported so the
 *  register button can invalidate it on success and the device-list UI
 *  can subscribe with the same key. */
export const passkeysQueryKey = ['passkeys', 'devices'] as const;

export const passkeysApi = {
  /** POST /webauthn/register/options — start the registration ceremony. */
  registerOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return api.post<PublicKeyCredentialCreationOptionsJSON>(
      '/webauthn/register/options',
    );
  },

  /** POST /webauthn/register/verify — finish the ceremony. */
  registerVerify(
    response: RegistrationResponseJSON,
    deviceName?: string,
  ): Promise<RegisterVerifyResult> {
    return api.post<RegisterVerifyResult>('/webauthn/register/verify', {
      response,
      ...(deviceName ? { deviceName } : {}),
    });
  },

  /**
   * POST /webauthn/authenticate/options — start the LOGIN ceremony.
   *
   * Pre-auth: this call has no JWT. The BE resolves the user by email
   * (+ optional tenantSlug when multiple tenants share an address) and
   * returns a session-binding `userId` we echo back on /verify. The
   * actual proof of identity is the signed assertion in step 3.
   */
  authenticateOptions(
    email: string,
    tenantSlug?: string,
  ): Promise<AuthenticateOptionsResponse> {
    return api.post<AuthenticateOptionsResponse>(
      '/webauthn/authenticate/options',
      { email, ...(tenantSlug ? { tenantSlug } : {}) },
    );
  },

  /**
   * POST /webauthn/authenticate/verify — finish login, get session tokens.
   *
   * Returns the same envelope as POST /auth/login: `{ user, tokens }`.
   * The refresh token is set as an httpOnly cookie by the BE and stripped
   * from the JSON body, so the caller passes the access token to
   * `useAuthStore.setSession()` exactly the same way the password flow does.
   */
  authenticateVerify(
    userId: string,
    response: AuthenticationResponseJSON,
  ): Promise<AuthenticateVerifyResult> {
    return api.post<AuthenticateVerifyResult>(
      '/webauthn/authenticate/verify',
      { userId, response },
    );
  },

  /**
   * GET /webauthn/devices — list user's registered passkeys (newest first).
   *
   * Server returns `{ devices: [...] }`; we unwrap to a plain array for the
   * React Query cache.
   */
  async list(): Promise<PasskeyDevice[]> {
    const res = await api.get<{ devices: PasskeyDevice[] }>('/webauthn/devices');
    return res.devices;
  },

  /**
   * DELETE /webauthn/devices/:id — revoke a single passkey.
   *
   * Server responds 204 No Content. Callers should invalidate the
   * `passkeysQueryKey` to refetch the list after a successful revoke.
   */
  async revoke(passkeyId: string): Promise<void> {
    await api.delete<void>(`/webauthn/devices/${encodeURIComponent(passkeyId)}`);
  },
};
