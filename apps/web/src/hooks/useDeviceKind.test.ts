import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDeviceKind } from './useDeviceKind';

/**
 * useDeviceKind synthesises three signals (viewport, pointer, standalone)
 * into a single DeviceInfo. Tests pin each detection path so a future
 * refactor of one signal doesn't silently move users from "tablet" to
 * "desktop" (which would silently disable touch-friendly affordances).
 */

function mockWindow({
  width = 1280,
  height = 720,
  pointerCoarse = false,
  standalone = false,
  userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit',
  maxTouchPoints = 0,
}: {
  width?: number;
  height?: number;
  pointerCoarse?: boolean;
  standalone?: boolean;
  userAgent?: string;
  maxTouchPoints?: number;
} = {}) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: userAgent });
  Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: maxTouchPoints });
  // iOS-only flag — set via cast since TS doesn't know about Safari's
  // proprietary `navigator.standalone`.
  (window.navigator as Navigator & { standalone?: boolean }).standalone = standalone;

  // Vitest 4 + jsdom 25 no longer ship a default matchMedia stub; spyOn
  // throws "Received undefined". Define a stub first, then replace via
  // assignment (no spyOn needed — the hook only reads the function).
  const matchMediaStub = vi.fn((query: string): MediaQueryList => ({
    matches:
      query === '(pointer: coarse)' ? pointerCoarse : query === '(display-mode: standalone)' ? standalone : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }) as MediaQueryList);
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMediaStub,
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useDeviceKind — kind classification', () => {
  it('phone: viewport < 640px', () => {
    mockWindow({ width: 375, pointerCoarse: true });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.kind).toBe('phone');
    expect(result.current.width).toBe(375);
  });

  it('tablet: viewport >= 640px AND pointer:coarse (iPad in Safari)', () => {
    mockWindow({ width: 820, pointerCoarse: true });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.kind).toBe('tablet');
  });

  it('desktop: viewport >= 640px AND pointer:fine (mouse / trackpad)', () => {
    mockWindow({ width: 1440, pointerCoarse: false });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.kind).toBe('desktop');
  });
});

describe('useDeviceKind — platform detection', () => {
  it('iOS iPhone via UA', () => {
    mockWindow({
      width: 390,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      pointerCoarse: true,
    });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.platform).toBe('ios');
  });

  it('iOS iPad-Pro unmasked via maxTouchPoints (iPadOS lies about UA)', () => {
    // iPadOS 13+ ships a Macintosh-shaped UA. maxTouchPoints > 1 is the tell.
    mockWindow({
      width: 1024,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit',
      maxTouchPoints: 5,
      pointerCoarse: true,
    });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.platform).toBe('ios');
    expect(result.current.kind).toBe('tablet');
  });

  it('Android', () => {
    mockWindow({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)' });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.platform).toBe('android');
  });

  it('macOS without touch reports macos (not ios)', () => {
    mockWindow({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit',
      maxTouchPoints: 0,
    });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.platform).toBe('macos');
  });

  it('Windows', () => {
    mockWindow({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.platform).toBe('windows');
  });
});

describe('useDeviceKind — PWA standalone detection', () => {
  it('iOS-flavoured standalone (navigator.standalone)', () => {
    mockWindow({ width: 390, standalone: true, pointerCoarse: true });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.standalone).toBe(true);
  });

  it('non-standalone (regular Safari tab)', () => {
    mockWindow({ width: 1440, standalone: false });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.standalone).toBe(false);
  });
});

describe('useDeviceKind — resize reactivity', () => {
  it('updates when viewport width changes (phone → desktop)', () => {
    mockWindow({ width: 375, pointerCoarse: true });
    const { result } = renderHook(() => useDeviceKind());
    expect(result.current.kind).toBe('phone');

    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
      Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn((q: string): MediaQueryList => ({
          matches: false,
          media: q,
          onchange: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as MediaQueryList),
      });
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current.kind).toBe('desktop');
  });
});
