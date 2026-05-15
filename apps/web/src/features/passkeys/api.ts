import type {
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { api, ApiError } from '@/lib/api';

/**
 * B2-PR3 — Frontend API wrapper for the passkey (WebAuthn) endpoints.
 *
 * Mirrors `apps/api/src/modules/webauthn/webauthn.controller.ts`. The auth
 * header is added by the shared `api` client, which reads the access token
 * from the auth store on every request.
 *
 * Register ceremony (used here):
 *   1. POST /webauthn/register/options  → server returns options JSON
 *   2. browser → navigator.credentials.create() via @simplewebauthn/browser
 *   3. POST /webauthn/register/verify   → server persists Passkey row
 *
 * The "list devices" endpoint (`GET /webauthn/devices`) does NOT exist yet —
 * it's part of B2-PR4 (device list + revoke UI). To avoid coupling this PR
 * to that work, `list()` swallows a 404 and returns an empty array, so the
 * future device-list section on the Settings page renders a stable empty
 * state today and will light up automatically once B2-PR4 ships the
 * endpoint. Any non-404 error still propagates so genuine failures (auth,
 * network, 500) are not hidden.
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

/** React Query key for the user's passkey device list. Exported so the
 *  register button can invalidate it on success and the device-list UI
 *  (B2-PR4) can subscribe with the same key. */
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
   * GET /webauthn/devices — list user's registered passkeys.
   *
   * Temporary behaviour until B2-PR4 lands: a 404 here means the endpoint
   * isn't wired yet, which we treat as "no devices yet from FE point of
   * view". This lets the Settings page render its passkey section against
   * a stable empty list today. Once the BE endpoint exists, this same call
   * starts returning real rows with no FE change required.
   */
  async list(): Promise<PasskeyDevice[]> {
    try {
      return await api.get<PasskeyDevice[]>('/webauthn/devices');
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return [];
      }
      throw err;
    }
  },
};
