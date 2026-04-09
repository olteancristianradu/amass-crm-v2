import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Client-side auth state.
 *
 * We keep access + refresh tokens in localStorage (via zustand/persist) so a
 * page reload doesn't require re-login. This is a conscious trade-off: XSS
 * risk is present but manageable because our content is locally-authored
 * (no user-generated HTML rendered as raw HTML). If/when we ship user
 * content rendering we'll move access tokens to memory-only.
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
  refreshToken: string;
  expiresIn: number;
}

interface AuthState {
  user: AuthUser | null;
  accessToken: string | null;
  refreshToken: string | null;
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
      refreshToken: null,
      isAuthenticated: () => !!get().accessToken && !!get().user,
      setSession: (user, tokens) =>
        set({
          user,
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),
      setTokens: (tokens) =>
        set({
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
        }),
      clear: () => set({ user: null, accessToken: null, refreshToken: null }),
    }),
    {
      name: 'amass-auth',
      storage: createJSONStorage(() => localStorage),
      // Only persist these fields — never persist method references.
      partialize: (s) => ({
        user: s.user,
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
      }),
    },
  ),
);
