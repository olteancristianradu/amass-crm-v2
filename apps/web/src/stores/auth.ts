import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Client-side auth state.
 *
 * M-10 — token storage posture:
 *   • refreshToken lives ONLY in an httpOnly cookie set by the API (see
 *     apps/api/src/modules/auth/refresh-cookie.ts). It never hits JS,
 *     so an XSS cannot exfiltrate it, and we no longer keep it on the
 *     client at all (no field, no localStorage entry).
 *   • accessToken is persisted so the SPA can render authenticated UI
 *     immediately on reload; when it expires mid-session the 401 path
 *     in lib/api.ts silently refreshes it via the cookie.
 *   • `user` stays in localStorage so the SPA can render the shell
 *     immediately on reload without a blank frame. Nothing sensitive is
 *     in there — just display name, email, role, tenantId.
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
      isAuthenticated: () => !!get().accessToken && !!get().user,
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
      // Only persist these fields — never persist method references, and
      // never persist the refresh token (cookie-only).
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
      }),
    },
  ),
);
