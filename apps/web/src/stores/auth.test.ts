import { describe, expect, it, beforeEach } from 'vitest';
import { useAuthStore, type AuthUser, type AuthTokens } from './auth';

const user: AuthUser = {
  id: 'u1',
  tenantId: 't1',
  email: 'a@b.ro',
  fullName: 'A B',
  role: 'OWNER',
};

const tokens: AuthTokens = {
  accessToken: 'acc-xyz',
  expiresIn: 900,
};

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.getState().clear();
    localStorage.clear();
  });

  it('starts empty', () => {
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.isAuthenticated()).toBe(false);
  });

  it('setSession populates user + accessToken (in-memory)', () => {
    useAuthStore.getState().setSession(user, tokens);
    const s = useAuthStore.getState();
    expect(s.user).toEqual(user);
    expect(s.accessToken).toBe('acc-xyz');
    expect(s.isAuthenticated()).toBe(true);
  });

  it('M-aud-H3: NEVER persists the access token to localStorage', () => {
    useAuthStore.getState().setSession(user, tokens);
    const raw = localStorage.getItem('amass-auth');
    expect(raw).toBeTruthy();
    // Token must not appear anywhere in the persisted blob — checked by
    // both substring (defends against re-keying the field) and JSON-shape
    // (defends against accidental top-level field additions).
    expect(raw!).not.toContain('acc-xyz');
    expect(raw!).not.toContain('accessToken');
    const parsed = JSON.parse(raw!);
    expect(parsed.state).toBeDefined();
    expect(parsed.state.accessToken).toBeUndefined();
    // user stays in storage so the chrome renders on reload
    expect(parsed.state.user).toEqual(user);
  });

  it('M-aud-H3: isAuthenticated stays true when only user is restored from localStorage', () => {
    // Simulate cold reload: user persisted, but in-memory access token gone.
    useAuthStore.setState({ user, accessToken: null });
    expect(useAuthStore.getState().isAuthenticated()).toBe(true);
  });

  it('setTokens rotates the accessToken without touching user', () => {
    useAuthStore.getState().setSession(user, tokens);
    useAuthStore.getState().setTokens({ accessToken: 'rotated', expiresIn: 900 });
    const s = useAuthStore.getState();
    expect(s.accessToken).toBe('rotated');
    expect(s.user).toEqual(user);
  });

  it('clear() wipes the session (logout)', () => {
    useAuthStore.getState().setSession(user, tokens);
    useAuthStore.getState().clear();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.accessToken).toBeNull();
    expect(s.isAuthenticated()).toBe(false);
  });

  it('never persists a refreshToken (M-10 cookie-only posture)', () => {
    useAuthStore.getState().setSession(user, { ...tokens, refreshToken: 'should-not-be-here' });
    const raw = localStorage.getItem('amass-auth');
    expect(raw).toBeTruthy();
    expect(raw!).not.toContain('refreshToken');
    expect(raw!).not.toContain('should-not-be-here');
  });
});
