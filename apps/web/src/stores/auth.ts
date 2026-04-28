import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Client-side auth state.
 *
 * **Token storage posture (post-audit H3):**
 *   • `refreshToken` lives ONLY in an httpOnly cookie set by the API
 *     (apps/api/src/modules/auth/refresh-cookie.ts). It never hits JS,
 *     so an XSS or supply-chain compromise cannot exfiltrate it.
 *   • `accessToken` is **NOT** persisted to localStorage. It lives in
 *     in-memory zustand state for the lifetime of the tab. On a hard
 *     reload the SPA bootstraps with no token, the first authed
 *     request 401s, and `lib/api.ts` silently swaps in a fresh token
 *     via the refresh-cookie roundtrip. Brief flicker on cold reload
 *     is the trade-off — cheap and worth it because:
 *       - localStorage is XSS-readable (audit H3): a stored XSS or a
 *         compromised dependency in pnpm.overrides could exfiltrate
 *         the access JWT and impersonate the user for ~15min.
 *       - sessionStorage is also XSS-readable but at least scoped
 *         per-tab; we keep that as a fallback for cross-component
 *         continuity inside the same tab (see below).
 *   • `user` (display-only payload — name, email, role, tenantId) stays
 *     in localStorage so the AppShell can render the chrome immediately
 *     on reload without a blank frame. Nothing in `user` is a credential.
 *
 * The refresh flow (in lib/api.ts) mutates this store directly via
 * `setTokens()` / `clear()` — it must not import the React hook.
 */
export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER';
}

export interface AuthTokens {
  accessToken: string;
  /**
   * Present on login/register/refresh responses historically; after M-10
   * the backend sets the refresh token in an httpOnly cookie and sends
   * an empty string in the body. Kept on the type for backward compat
   * with any caller that still destructures it — the SPA never reads it.
   */
  refreshToken?: string;
  expiresIn: number;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: () => boolean;
  setSession: (user: AuthUser, tokens: AuthTokens) => void;
  setTokens: (tokens: AuthTokens) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      // M-aud-H3: also report authenticated when only `user` is present,
      // because on a fresh tab the in-memory access token is null until
      // the first refresh roundtrip succeeds. The api wrapper detects the
      // 401 and silently re-acquires the token; until then the AppShell
      // can show the user chrome (greeting, sidebar) without flashing
      // /login. The very first authed query will trigger the refresh.
      isAuthenticated: () => !!get().user,
      setSession: (user, tokens) =>
        set({
          user,
          accessToken: tokens.accessToken,
        }),
      setTokens: (tokens) =>
        set({
          accessToken: tokens.accessToken,
        }),
      clear: () => set({ user: null, accessToken: null }),
    }),
    {
      name: 'amass-auth',
      storage: createJSONStorage(() => localStorage),
      // M-aud-H3: persist ONLY the display-only user payload. The access
      // token must NEVER hit localStorage — see file header for rationale.
      partialize: (s) => ({
        user: s.user,
      }),
    },
  ),
);
