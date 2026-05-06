import { describe, expect, it, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePageTitle } from './usePageTitle';

describe('usePageTitle', () => {
  beforeEach(() => {
    document.title = 'AMASS-CRM';
  });

  it('sets document.title with brand suffix', () => {
    renderHook(() => usePageTitle('Pro Cockpit'));
    expect(document.title).toBe('Pro Cockpit · AMASS CRM');
  });

  it('restores previous title on unmount', () => {
    document.title = 'Original';
    const { unmount } = renderHook(() => usePageTitle('Inner'));
    expect(document.title).toBe('Inner · AMASS CRM');
    unmount();
    expect(document.title).toBe('Original');
  });

  it('does nothing when title is null/undefined/empty', () => {
    document.title = 'Unchanged';
    renderHook(() => usePageTitle(null));
    expect(document.title).toBe('Unchanged');
    renderHook(() => usePageTitle(undefined));
    expect(document.title).toBe('Unchanged');
    renderHook(() => usePageTitle(''));
    expect(document.title).toBe('Unchanged');
  });

  it('updates when title prop changes', () => {
    const { rerender } = renderHook(({ t }: { t: string }) => usePageTitle(t), {
      initialProps: { t: 'A' },
    });
    expect(document.title).toBe('A · AMASS CRM');
    rerender({ t: 'B' });
    expect(document.title).toBe('B · AMASS CRM');
  });
});
