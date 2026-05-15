import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * B2-PR4 — LoginWithPasskeyButton tests.
 *
 * Mock surface (same approach as RegisterPasskeyButton.test):
 *   - @simplewebauthn/browser: pinned per-test (so jsdom never touches
 *     real navigator.credentials.get).
 *   - ./api: every passkeysApi method becomes a vi.fn() we wire by case.
 *   - @tanstack/react-router: navigate is a spy so we can assert that
 *     happy-path lands the user at /app.
 *   - @/stores/auth: setSession is a spy — we assert it gets the user
 *     + access token from the verify response (same shape as /auth/login).
 *
 * The tests don't depend on the full RouterProvider — useRouter is mocked
 * to return a stub with a navigate method. That keeps each test fast and
 * isolated from real route setup.
 */

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  startAuthentication: vi.fn(() => Promise.reject(new Error('not configured'))),
}));

vi.mock('./api', () => ({
  passkeysApi: {
    authenticateOptions: vi.fn(),
    authenticateVerify: vi.fn(),
    list: vi.fn(),
    revoke: vi.fn(),
    registerOptions: vi.fn(),
    registerVerify: vi.fn(),
  },
}));

const navigateSpy = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ navigate: navigateSpy }),
}));

const setSessionSpy = vi.fn();
vi.mock('@/stores/auth', () => ({
  useAuthStore: <T,>(selector: (s: { setSession: typeof setSessionSpy }) => T) =>
    selector({ setSession: setSessionSpy }),
}));

import * as swBrowser from '@simplewebauthn/browser';
import { passkeysApi } from './api';
import { ApiError } from '@/lib/api';
import { LoginWithPasskeyButton } from './LoginWithPasskeyButton';

const FAKE_OPTIONS = {
  challenge: 'auth-challenge',
  rpId: 'localhost',
  allowCredentials: [{ id: 'CRED_X', type: 'public-key' as const }],
  timeout: 60000,
  userVerification: 'preferred' as const,
};
const FAKE_OPTIONS_RESP = { options: FAKE_OPTIONS, userId: 'u1' };

const FAKE_ASSERTION = {
  id: 'CRED_X',
  rawId: 'CRED_X',
  type: 'public-key' as const,
  response: {
    clientDataJSON: 'cdj',
    authenticatorData: 'ad',
    signature: 'sig',
  },
  clientExtensionResults: {},
};

const FAKE_VERIFY_RESULT = {
  user: {
    id: 'u1',
    tenantId: 't1',
    email: 'a@x.ro',
    fullName: 'A',
    role: 'AGENT' as const,
  },
  tokens: {
    accessToken: 'JWT.ACCESS',
    refreshToken: '',
    expiresIn: 900,
  },
};

describe('LoginWithPasskeyButton', () => {
  beforeEach(() => {
    vi.mocked(swBrowser.browserSupportsWebAuthn).mockReturnValue(true);
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: full ceremony → setSession applied → navigates to /app', async () => {
    vi.mocked(passkeysApi.authenticateOptions).mockResolvedValue(
      FAKE_OPTIONS_RESP as never,
    );
    vi.mocked(swBrowser.startAuthentication).mockResolvedValue(
      FAKE_ASSERTION as never,
    );
    vi.mocked(passkeysApi.authenticateVerify).mockResolvedValue(
      FAKE_VERIFY_RESULT as never,
    );

    render(<LoginWithPasskeyButton />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Email'), 'a@x.ro');
    await user.click(
      screen.getByRole('button', { name: /Conectare cu passkey/i }),
    );

    await waitFor(() => {
      expect(passkeysApi.authenticateOptions).toHaveBeenCalledWith(
        'a@x.ro',
        undefined,
      );
    });
    // The library was passed the optionsJSON from the BE
    expect(swBrowser.startAuthentication).toHaveBeenCalledWith({
      optionsJSON: FAKE_OPTIONS,
    });
    // Verify got the userId hint + the assertion the browser produced
    await waitFor(() => {
      expect(passkeysApi.authenticateVerify).toHaveBeenCalledWith(
        'u1',
        FAKE_ASSERTION,
      );
    });
    // Tokens applied to the auth store
    await waitFor(() => {
      expect(setSessionSpy).toHaveBeenCalledWith(
        FAKE_VERIFY_RESULT.user,
        FAKE_VERIFY_RESULT.tokens,
      );
    });
    // Router navigated to /app
    await waitFor(() => {
      expect(navigateSpy).toHaveBeenCalledWith({ to: '/app' });
    });
  });

  it('returns null when browserSupportsWebAuthn() is false — nothing rendered', () => {
    vi.mocked(swBrowser.browserSupportsWebAuthn).mockReturnValue(false);
    const { container } = render(<LoginWithPasskeyButton />);
    // Component renders absolutely nothing (no button, no fallback markup —
    // the login page falls back to the password form).
    expect(container.firstChild).toBeNull();
  });

  it('user cancels at the authenticator UI → Anulat error, no verify call', async () => {
    vi.mocked(passkeysApi.authenticateOptions).mockResolvedValue(
      FAKE_OPTIONS_RESP as never,
    );
    vi.mocked(swBrowser.startAuthentication).mockRejectedValue(
      new DOMException('User cancelled', 'NotAllowedError'),
    );

    render(<LoginWithPasskeyButton />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'a@x.ro');
    await user.click(
      screen.getByRole('button', { name: /Conectare cu passkey/i }),
    );

    expect(await screen.findByText('Anulat')).toBeInTheDocument();
    expect(passkeysApi.authenticateVerify).not.toHaveBeenCalled();
    expect(setSessionSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('server returns INVALID_CREDENTIALS → generic Romanian error, no navigation', async () => {
    // Simulate the BE's "no user / no passkey / wrong tenant" uniform 401.
    vi.mocked(passkeysApi.authenticateOptions).mockRejectedValue(
      new ApiError(401, { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' }),
    );

    render(<LoginWithPasskeyButton />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'ghost@x.ro');
    await user.click(
      screen.getByRole('button', { name: /Conectare cu passkey/i }),
    );

    expect(
      await screen.findByText('Nu există un passkey înregistrat pentru acest email'),
    ).toBeInTheDocument();
    expect(swBrowser.startAuthentication).not.toHaveBeenCalled();
    expect(setSessionSpy).not.toHaveBeenCalled();
    expect(navigateSpy).not.toHaveBeenCalled();
  });

  it('button is disabled until the user types an email', async () => {
    render(<LoginWithPasskeyButton />);
    const btn = screen.getByRole('button', { name: /Conectare cu passkey/i });
    expect(btn).toBeDisabled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Email'), 'a@x.ro');
    expect(btn).not.toBeDisabled();
  });

  it('email prop hides the inline input and is used for the ceremony', async () => {
    vi.mocked(passkeysApi.authenticateOptions).mockResolvedValue(
      FAKE_OPTIONS_RESP as never,
    );
    vi.mocked(swBrowser.startAuthentication).mockResolvedValue(
      FAKE_ASSERTION as never,
    );
    vi.mocked(passkeysApi.authenticateVerify).mockResolvedValue(
      FAKE_VERIFY_RESULT as never,
    );

    render(<LoginWithPasskeyButton email="from-parent@x.ro" />);
    // Inline input is NOT rendered when email comes from prop
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /Conectare cu passkey/i }),
    );
    await waitFor(() => {
      expect(passkeysApi.authenticateOptions).toHaveBeenCalledWith(
        'from-parent@x.ro',
        undefined,
      );
    });
  });
});
