import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * B2-PR4 — DeviceList tests.
 *
 * Mock surface:
 *   - ./api: every passkeysApi method becomes a vi.fn().
 *   - @/stores/toasts: toast is a spy.
 *   - window.confirm: stubbed per test (true → confirm flow, false → cancel).
 *
 * We use a fresh QueryClient per test (retry off) so React Query mutation
 * state doesn't bleed between cases.
 */

vi.mock('./api', () => ({
  passkeysApi: {
    list: vi.fn(),
    revoke: vi.fn(),
    registerOptions: vi.fn(),
    registerVerify: vi.fn(),
    authenticateOptions: vi.fn(),
    authenticateVerify: vi.fn(),
  },
  passkeysQueryKey: ['passkeys', 'devices'] as const,
}));

vi.mock('@/stores/toasts', () => ({
  toast: vi.fn(),
  useToastStore: { getState: () => ({ push: vi.fn() }) },
}));

import { passkeysApi } from './api';
import { toast } from '@/stores/toasts';
import { DeviceList } from './DeviceList';

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderList(): { client: QueryClient; container: HTMLElement } {
  const client = makeClient();
  const { container } = render(
    <QueryClientProvider client={client}>
      <DeviceList />
    </QueryClientProvider>,
  );
  return { client, container };
}

const MOCK_DEVICES = [
  {
    id: 'pk1',
    credentialId: 'CRED_A',
    deviceName: 'MacBook Pro',
    transports: ['internal'],
    createdAt: new Date(Date.now() - 5 * 86400_000).toISOString(),
    lastUsedAt: new Date(Date.now() - 3600_000).toISOString(),
  },
  {
    id: 'pk2',
    credentialId: 'CRED_B',
    deviceName: 'YubiKey 5C',
    transports: ['usb', 'nfc'],
    createdAt: new Date(Date.now() - 30 * 86400_000).toISOString(),
    lastUsedAt: null,
  },
  {
    id: 'pk3',
    credentialId: 'CRED_C',
    deviceName: null,
    transports: ['internal'],
    createdAt: new Date(Date.now() - 60 * 86400_000).toISOString(),
    lastUsedAt: new Date(Date.now() - 86400_000).toISOString(),
  },
];

describe('DeviceList', () => {
  // Type as MockInstance — Window.confirm is typed as a property bag on
  // Window which vi.spyOn's generic doesn't accept; the simpler form
  // below sidesteps the type and still gets per-test isolation.
  let confirmSpy: ReturnType<typeof vi.fn> & {
    mockReturnValue: (v: boolean) => void;
    mockRestore: () => void;
  };
  const originalConfirm = window.confirm;
  beforeEach(() => {
    const spy = vi.fn((_message?: string) => true);
    window.confirm = spy as unknown as typeof window.confirm;
    confirmSpy = Object.assign(spy, {
      mockRestore: () => {
        window.confirm = originalConfirm;
      },
    }) as never;
  });
  afterEach(() => {
    vi.clearAllMocks();
    confirmSpy.mockRestore();
  });

  it('renders 3 device rows with names, transports, and revoke buttons', async () => {
    vi.mocked(passkeysApi.list).mockResolvedValue(MOCK_DEVICES as never);

    renderList();

    await waitFor(() => {
      expect(screen.getAllByTestId('passkey-device-row')).toHaveLength(3);
    });
    expect(screen.getByText('MacBook Pro')).toBeInTheDocument();
    expect(screen.getByText('YubiKey 5C')).toBeInTheDocument();
    // Null deviceName falls back to "Device necunoscut"
    expect(screen.getByText('Device necunoscut')).toBeInTheDocument();
    // Revoke button per row
    expect(
      screen.getAllByRole('button', { name: /^Revocă/ }),
    ).toHaveLength(3);
  });

  it('shows the Romanian empty state when the user has no passkeys', async () => {
    vi.mocked(passkeysApi.list).mockResolvedValue([]);

    renderList();

    await waitFor(() => {
      expect(
        screen.getByText('Nu ai niciun passkey înregistrat.'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('Folosește butonul de mai sus pentru a începe.'),
    ).toBeInTheDocument();
    // No device rows
    expect(screen.queryByTestId('passkey-device-row')).not.toBeInTheDocument();
  });

  it('revoke flow: confirm → API call → list invalidated → toast shown', async () => {
    vi.mocked(passkeysApi.list).mockResolvedValue(MOCK_DEVICES as never);
    vi.mocked(passkeysApi.revoke).mockResolvedValue(undefined);

    const { client } = renderList();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() => {
      expect(screen.getAllByTestId('passkey-device-row')).toHaveLength(3);
    });

    const user = userEvent.setup();
    // Click the revoke button on the first row (MacBook Pro = pk1)
    await user.click(
      screen.getByRole('button', { name: /Revocă MacBook Pro/i }),
    );

    expect(confirmSpy).toHaveBeenCalledWith('Sigur dezactivezi acest passkey?');
    await waitFor(() => {
      expect(passkeysApi.revoke).toHaveBeenCalledWith('pk1');
    });
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['passkeys', 'devices'],
      });
    });
    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith('Passkey revocat ✓');
    });
  });

  it('revoke flow with cancel: confirm returns false → API NOT called', async () => {
    vi.mocked(passkeysApi.list).mockResolvedValue(MOCK_DEVICES as never);
    vi.mocked(passkeysApi.revoke).mockResolvedValue(undefined);
    confirmSpy.mockReturnValue(false);

    renderList();
    await waitFor(() => {
      expect(screen.getAllByTestId('passkey-device-row')).toHaveLength(3);
    });

    const user = userEvent.setup();
    await user.click(
      screen.getByRole('button', { name: /Revocă MacBook Pro/i }),
    );

    expect(confirmSpy).toHaveBeenCalled();
    // No API hit, no toast — the user cancelled
    expect(passkeysApi.revoke).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('shows loading skeleton while the list is fetching', () => {
    // Pending promise — never resolves during the assertion window.
    vi.mocked(passkeysApi.list).mockReturnValue(
      new Promise(() => undefined) as never,
    );
    renderList();
    expect(screen.getByTestId('passkey-list-loading')).toBeInTheDocument();
  });

  it('carries data-tour="settings-security-devices" on the wrapper', async () => {
    vi.mocked(passkeysApi.list).mockResolvedValue([]);
    const { container } = renderList();
    // Top-level wrapper exposes the tour anchor — matches the Settings
    // page placeholder slot so the tour script keeps working.
    await waitFor(() => {
      const wrapper = container.querySelector(
        '[data-tour="settings-security-devices"]',
      );
      expect(wrapper).not.toBeNull();
    });
  });
});
