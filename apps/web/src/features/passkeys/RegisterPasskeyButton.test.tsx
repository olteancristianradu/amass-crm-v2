import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * B2-PR3 — RegisterPasskeyButton unit tests.
 *
 * We mock both @simplewebauthn/browser (so no real navigator.credentials
 * call) and the passkeysApi module (so no real network). Each test asserts
 * one slice of the flow: happy path, user-cancel, server failure, and
 * in-flight disabling.
 *
 * The mocks are declared with `vi.mock(...)` at the top so they hoist
 * above the lazy imports — otherwise vitest's hoist would still work but
 * we'd risk a real import of @simplewebauthn/browser pulling navigator
 * APIs jsdom doesn't have.
 */

vi.mock('@simplewebauthn/browser', () => ({
  browserSupportsWebAuthn: vi.fn(() => true),
  // startRegistration is replaced per-test below; default = throws so a
  // misconfigured test fails loud instead of silently passing.
  startRegistration: vi.fn(() => Promise.reject(new Error('not configured'))),
}));

vi.mock('./api', () => ({
  passkeysApi: {
    registerOptions: vi.fn(),
    registerVerify: vi.fn(),
    list: vi.fn(),
  },
  passkeysQueryKey: ['passkeys', 'devices'] as const,
}));

vi.mock('@/stores/toasts', () => ({
  toast: vi.fn(),
  useToastStore: { getState: () => ({ push: vi.fn() }) },
}));

import * as swBrowser from '@simplewebauthn/browser';
import { passkeysApi } from './api';
import { toast } from '@/stores/toasts';
import { RegisterPasskeyButton } from './RegisterPasskeyButton';

/** Fresh QueryClient per test — otherwise mutation state leaks across tests. */
function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderButton(): void {
  const client = makeClient();
  render(
    <QueryClientProvider client={client}>
      <RegisterPasskeyButton />
    </QueryClientProvider>,
  );
}

const FAKE_OPTIONS = {
  challenge: 'fake-challenge',
  rp: { name: 'Amass', id: 'localhost' },
  user: { id: 'uid', name: 'a@x.ro', displayName: 'A' },
  pubKeyCredParams: [],
  timeout: 60000,
  attestation: 'none' as const,
};

const FAKE_ATTESTATION = {
  id: 'cred-id',
  rawId: 'cred-id',
  type: 'public-key' as const,
  response: {
    clientDataJSON: 'cdj',
    attestationObject: 'ao',
  },
  clientExtensionResults: {},
};

describe('RegisterPasskeyButton', () => {
  beforeEach(() => {
    vi.mocked(swBrowser.browserSupportsWebAuthn).mockReturnValue(true);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: clicks → options → startRegistration → verify → success toast', async () => {
    vi.mocked(passkeysApi.registerOptions).mockResolvedValue(
      FAKE_OPTIONS as never,
    );
    vi.mocked(swBrowser.startRegistration).mockResolvedValue(
      FAKE_ATTESTATION as never,
    );
    vi.mocked(passkeysApi.registerVerify).mockResolvedValue({
      passkeyId: 'pk-1',
      credentialId: 'cred-id',
    });

    renderButton();
    const user = userEvent.setup();

    await user.click(
      screen.getByRole('button', { name: /Înregistrează passkey/i }),
    );

    await waitFor(() => {
      expect(passkeysApi.registerOptions).toHaveBeenCalledTimes(1);
    });
    expect(swBrowser.startRegistration).toHaveBeenCalledWith({
      optionsJSON: FAKE_OPTIONS,
    });
    await waitFor(() => {
      expect(passkeysApi.registerVerify).toHaveBeenCalledTimes(1);
    });
    expect(passkeysApi.registerVerify).toHaveBeenCalledWith(
      FAKE_ATTESTATION,
      undefined,
    );
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Passkey înregistrat ✓');
    });
  });

  it('user cancels in the authenticator UI → Romanian message, no verify call', async () => {
    vi.mocked(passkeysApi.registerOptions).mockResolvedValue(
      FAKE_OPTIONS as never,
    );
    // DOMException with name=NotAllowedError is what the browser throws on
    // user cancel or timeout. We construct it manually because jsdom's
    // DOMException ctor honours the name argument.
    vi.mocked(swBrowser.startRegistration).mockRejectedValue(
      new DOMException('User cancelled', 'NotAllowedError'),
    );

    renderButton();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /Înregistrează passkey/i }),
    );

    expect(
      await screen.findByText('Anulat — poți reîncerca oricând'),
    ).toBeInTheDocument();
    expect(passkeysApi.registerVerify).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('server errors on verify → error message rendered', async () => {
    vi.mocked(passkeysApi.registerOptions).mockResolvedValue(
      FAKE_OPTIONS as never,
    );
    vi.mocked(swBrowser.startRegistration).mockResolvedValue(
      FAKE_ATTESTATION as never,
    );
    vi.mocked(passkeysApi.registerVerify).mockRejectedValue(
      new Error('Could not verify attestation'),
    );

    renderButton();
    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /Înregistrează passkey/i }),
    );

    // Generic-error path: plain Error gets the fallback Romanian copy.
    expect(
      await screen.findByTestId('passkey-register-error'),
    ).toBeInTheDocument();
    expect(toast).not.toHaveBeenCalled();
  });

  it('disables the button while the request is in flight', async () => {
    // Resolve registerOptions only when we manually call `resolve()` — lets
    // us inspect the disabled state mid-flight without timing races.
    let resolveOptions: ((v: unknown) => void) | undefined;
    vi.mocked(passkeysApi.registerOptions).mockReturnValue(
      new Promise((res) => {
        resolveOptions = res;
      }) as never,
    );
    // Once the options resolve, we want a clean settle to idle — wire the
    // remaining mocks so the in-flight phase finishes without spam.
    vi.mocked(swBrowser.startRegistration).mockResolvedValue(
      FAKE_ATTESTATION as never,
    );
    vi.mocked(passkeysApi.registerVerify).mockResolvedValue({
      passkeyId: 'pk-1',
      credentialId: 'cred-id',
    });

    renderButton();
    const user = userEvent.setup();
    const btn = screen.getByRole('button', { name: /Înregistrează passkey/i });
    await user.click(btn);

    // Mid-flight: button is disabled + label changed
    await waitFor(() => {
      const inFlightBtn = screen.getByRole('button', {
        name: /Se pregătește|Confirmă pe dispozitiv|Se verifică/i,
      });
      expect(inFlightBtn).toBeDisabled();
      expect(inFlightBtn).toHaveAttribute('aria-busy', 'true');
    });

    // Resolve the pending options promise so the mutation finishes inside
    // an `act` scope — otherwise React logs "not wrapped in act" warnings
    // for the state transitions that happen during test teardown.
    await act(async () => {
      resolveOptions?.(FAKE_OPTIONS);
    });
    await waitFor(() => {
      expect(passkeysApi.registerVerify).toHaveBeenCalled();
    });
  });

  it('renders an explainer when the browser does not support WebAuthn', () => {
    vi.mocked(swBrowser.browserSupportsWebAuthn).mockReturnValue(false);
    renderButton();
    expect(
      screen.getByText('Browser-ul nu suportă passkeys'),
    ).toBeInTheDocument();
    // No button rendered → click never possible
    expect(
      screen.queryByRole('button', { name: /Înregistrează passkey/i }),
    ).not.toBeInTheDocument();
  });
});
