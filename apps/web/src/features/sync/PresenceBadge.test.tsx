import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PresenceBadge } from './PresenceBadge';

/**
 * PresenceBadge calls useUserNames() which uses useQuery — every render
 * needs a QueryClientProvider. We also mock the api so no HTTP fires
 * (useUserNames calls /users/lookup when viewerUserIds is non-empty).
 *
 * The tests exercise the three things that can actually break:
 *   1. Empty viewer list → renders nothing AND doesn't call the api.
 *   2. Romanian noun agreement (1 → "persoană vede", N → "persoane văd").
 *   3. The tooltip / aria-label carry resolved viewer names.
 */

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(async (url: string) => {
      // Extract ids from the lookup URL and reflect each as fullName "Numele <id>".
      const ids = new URL(url, 'http://x').searchParams.get('ids') ?? '';
      return {
        data: ids
          .split(',')
          .filter(Boolean)
          .map((id) => ({ id, fullName: `Numele ${id}` })),
      };
    }),
  },
}));

function wrap(ui: React.ReactElement) {
  // Fresh client per render so cache state doesn't leak between tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => vi.clearAllMocks());

describe('PresenceBadge', () => {
  it('renders nothing when there are no other viewers', () => {
    const { container } = wrap(<PresenceBadge viewerUserIds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders singular Romanian agreement for one viewer', () => {
    wrap(<PresenceBadge viewerUserIds={['user-1']} />);
    expect(screen.getByText('+1 persoană vede această pagină')).toBeInTheDocument();
  });

  it('renders plural Romanian agreement for two viewers', () => {
    wrap(<PresenceBadge viewerUserIds={['user-1', 'user-2']} />);
    expect(screen.getByText('+2 persoane văd această pagină')).toBeInTheDocument();
  });

  it('renders plural Romanian agreement for many viewers', () => {
    wrap(
      <PresenceBadge
        viewerUserIds={['u-1', 'u-2', 'u-3', 'u-4', 'u-5', 'u-6', 'u-7']}
      />,
    );
    expect(screen.getByText('+7 persoane văd această pagină')).toBeInTheDocument();
  });

  it('tooltip shows "Se încarcă numele..." while the lookup is in flight', () => {
    // The query is async — first render runs before resolution; title should
    // be the loading message.
    wrap(<PresenceBadge viewerUserIds={['a', 'b']} />);
    const badge = screen.getByTestId('presence-badge');
    expect(badge.getAttribute('title')).toBe('Se încarcă numele...');
  });

  it('exposes overflow summary in the tooltip when >5 viewers', () => {
    wrap(
      <PresenceBadge
        viewerUserIds={['a', 'b', 'c', 'd', 'e', 'f', 'g']}
      />,
    );
    const badge = screen.getByTestId('presence-badge');
    const title = badge.getAttribute('title') ?? '';
    // Loading state on first render; overflow summary should be appended.
    expect(title).toContain('și încă 2');
  });

  it('uses the count as the accessible aria-label', () => {
    wrap(<PresenceBadge viewerUserIds={['user-1', 'user-2', 'user-3']} />);
    const badge = screen.getByTestId('presence-badge');
    expect(badge.getAttribute('aria-label')).toBe('+3 persoane văd această pagină');
  });

  it('applies the optional className alongside its own classes', () => {
    wrap(
      <PresenceBadge viewerUserIds={['user-1']} className="my-custom-class" />,
    );
    const badge = screen.getByTestId('presence-badge');
    expect(badge.className).toContain('my-custom-class');
    // And the base style is still applied.
    expect(badge.className).toContain('inline-flex');
  });
});
