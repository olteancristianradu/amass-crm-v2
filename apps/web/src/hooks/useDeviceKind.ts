import { useEffect, useState } from 'react';

/**
 * Device kind classification. Computed from a combination of viewport width,
 * pointer type, and platform signals. Falls back to "desktop" on the server
 * (no `window`) so SSR / first paint never returns `undefined`.
 *
 *   phone   — viewport width  <  640px (Tailwind `sm` breakpoint)
 *   tablet  — viewport width >= 640px AND coarse pointer (touch primary)
 *   desktop — viewport width >= 640px AND fine pointer (mouse / trackpad)
 *
 * The pointer check is what makes a 768px iPad Mini in Safari come back as
 * "tablet" instead of "desktop": iPadOS reports width >= 640 BUT
 * `pointer: coarse` because the primary input is a finger. A Surface Pro
 * with the type cover attached reports `pointer: fine` and lands in
 * "desktop" — which matches the user's actual interaction model.
 */
export type DeviceKind = 'phone' | 'tablet' | 'desktop';

/**
 * iOS detection — separate signal because Safari on iPad-Pro after
 * iPadOS 13 lies about its UA (claims macOS). The check below catches
 * the maxTouchPoints idiom that Apple still leaves in place.
 */
export type DevicePlatform = 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'unknown';

export interface DeviceInfo {
  kind: DeviceKind;
  platform: DevicePlatform;
  /**
   * True when the app is being rendered inside a PWA standalone window
   * (user added to home screen on iOS, or installed via Chrome's
   * "Install app" prompt). The auth + topbar should hide some affordances
   * in this mode (e.g. "Open in browser" link doesn't make sense).
   */
  standalone: boolean;
  /** Current viewport width in px (kept in sync via resize listener). */
  width: number;
  /** Current viewport height in px (kept in sync). */
  height: number;
}

function classifyKind(width: number, coarsePointer: boolean): DeviceKind {
  if (width < 640) return 'phone';
  if (coarsePointer) return 'tablet';
  return 'desktop';
}

function detectPlatform(): DevicePlatform {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  // iPad on iPadOS 13+ claims macOS; the maxTouchPoints check unmasks it.
  // Safari Mac never has maxTouchPoints > 0 (no touchscreen Mac shipped).
  if (/iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  if (/Android/.test(ua)) return 'android';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macos';
  if (/Windows/.test(ua)) return 'windows';
  if (/Linux/.test(ua)) return 'linux';
  return 'unknown';
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  // iOS Safari sets navigator.standalone when the page is launched from
  // the home screen. Chromium-based browsers expose the same state via
  // matchMedia(display-mode: standalone).
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const cssStandalone = window.matchMedia?.('(display-mode: standalone)').matches === true;
  return iosStandalone || cssStandalone;
}

function read(): DeviceInfo {
  if (typeof window === 'undefined') {
    return { kind: 'desktop', platform: 'unknown', standalone: false, width: 1280, height: 720 };
  }
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  return {
    kind: classifyKind(window.innerWidth, coarse),
    platform: detectPlatform(),
    standalone: detectStandalone(),
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * Reactive device-kind hook. Re-runs on resize and on the (rare) pointer-
 * type media query change (e.g. user docks an iPad into a hub with a
 * mouse — the primary pointer flips from coarse to fine).
 *
 * Usage:
 *   const { kind, platform, standalone } = useDeviceKind();
 *   if (kind === 'phone') return <CompactView />;
 *
 * Stable: returns the SAME object reference across re-renders when none
 * of the values changed — safe to use in dependency arrays.
 */
export function useDeviceKind(): DeviceInfo {
  const [info, setInfo] = useState<DeviceInfo>(() => read());

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const update = () => setInfo((prev) => {
      const next = read();
      // Reference-stable when nothing changed — saves consumer re-renders.
      if (
        next.kind === prev.kind &&
        next.platform === prev.platform &&
        next.standalone === prev.standalone &&
        next.width === prev.width &&
        next.height === prev.height
      ) {
        return prev;
      }
      return next;
    });

    window.addEventListener('resize', update);
    const pointerMql = window.matchMedia?.('(pointer: coarse)');
    pointerMql?.addEventListener?.('change', update);
    const standaloneMql = window.matchMedia?.('(display-mode: standalone)');
    standaloneMql?.addEventListener?.('change', update);

    return () => {
      window.removeEventListener('resize', update);
      pointerMql?.removeEventListener?.('change', update);
      standaloneMql?.removeEventListener?.('change', update);
    };
  }, []);

  return info;
}
