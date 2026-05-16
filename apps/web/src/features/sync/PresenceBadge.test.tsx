import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PresenceBadge } from './PresenceBadge';

/**
 * PresenceBadge is a pure presentational component — no socket, no
 * provider, no async. The tests exercise the three things that can
 * actually break:
 *   1. Empty viewer list → renders nothing.
 *   2. Romanian noun agreement (1 → "persoană vede", N → "persoane văd").
 *   3. The tooltip / aria-label carry the viewer userIds.
 */

describe('PresenceBadge', () => {
  it('renders nothing when there are no other viewers', () => {
    const { container } = render(<PresenceBadge viewerUserIds={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders singular Romanian agreement for one viewer', () => {
    render(<PresenceBadge viewerUserIds={['user-1']} />);
    expect(screen.getByText('+1 persoană vede această pagină')).toBeInTheDocument();
  });

  it('renders plural Romanian agreement for two viewers', () => {
    render(<PresenceBadge viewerUserIds={['user-1', 'user-2']} />);
    expect(screen.getByText('+2 persoane văd această pagină')).toBeInTheDocument();
  });

  it('renders plural Romanian agreement for many viewers', () => {
    render(
      <PresenceBadge
        viewerUserIds={['u-1', 'u-2', 'u-3', 'u-4', 'u-5', 'u-6', 'u-7']}
      />,
    );
    expect(screen.getByText('+7 persoane văd această pagină')).toBeInTheDocument();
  });

  it('exposes viewer userIds via the title tooltip (capped at 5 + "și încă N")', () => {
    render(
      <PresenceBadge
        viewerUserIds={['a', 'b', 'c', 'd', 'e', 'f', 'g']}
      />,
    );
    const badge = screen.getByTestId('presence-badge');
    const title = badge.getAttribute('title') ?? '';
    // First 5 should be listed verbatim.
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      expect(title).toContain(`User ${id}`);
    }
    // Overflow summary present.
    expect(title).toContain('și încă 2');
    // Items beyond the cap should NOT show up by id.
    expect(title).not.toContain('User f');
    expect(title).not.toContain('User g');
  });

  it('uses the count as the accessible aria-label', () => {
    render(<PresenceBadge viewerUserIds={['user-1', 'user-2', 'user-3']} />);
    const badge = screen.getByTestId('presence-badge');
    expect(badge.getAttribute('aria-label')).toBe('+3 persoane văd această pagină');
  });

  it('applies the optional className alongside its own classes', () => {
    render(
      <PresenceBadge viewerUserIds={['user-1']} className="my-custom-class" />,
    );
    const badge = screen.getByTestId('presence-badge');
    expect(badge.className).toContain('my-custom-class');
    // And the base style is still applied.
    expect(badge.className).toContain('inline-flex');
  });
});
