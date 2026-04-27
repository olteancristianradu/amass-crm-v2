import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UI density. Drives a CSS custom property `--density-scale` on <html>:
 *   comfortable → 1     (default; spacing/typography from design tokens)
 *   compact     → 0.85  (~15% tighter; useful for sales agents on
 *                        smaller screens or who want more rows in view)
 *
 * The toggle lives in the topbar. Persisted in localStorage so the
 * choice survives reload + tab close.
 *
 * Theme: light | dark | system (the latter follows prefers-color-scheme).
 * Driven by writing data-theme on <html> and Tailwind's
 * `darkMode: ['selector', '[data-theme="dark"]']`. CSS variable swap
 * lives in styles.css.
 *
 * Tenant accent: an additional CSS variable `--accent-tenant` (HSL
 * triplet) lets each tenant brand the focus ring + active-pill colour
 * subtly. Defaults to the same near-black as `--primary`.
 */
export type Density = 'comfortable' | 'compact';
export type Theme = 'light' | 'dark' | 'system';

interface UiPreferencesState {
  density: Density;
  theme: Theme;
  /** HSL triplet "H S% L%". Default = primary near-black. */
  accentTenant: string;
  setDensity: (d: Density) => void;
  setTheme: (t: Theme) => void;
  setAccentTenant: (hsl: string) => void;
}

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      density: 'comfortable',
      theme: 'system',
      accentTenant: '222 47% 11%', // matches default --primary
      setDensity: (density) => {
        set({ density });
        applyDensity(density);
      },
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      setAccentTenant: (accentTenant) => {
        set({ accentTenant });
        applyAccent(accentTenant);
      },
    }),
    {
      name: 'amass-ui-prefs',
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyDensity(state.density);
          applyTheme(state.theme);
          applyAccent(state.accentTenant);
        }
      },
    },
  ),
);

function applyDensity(d: Density): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = d;
  document.documentElement.style.setProperty('--density-scale', d === 'compact' ? '0.85' : '1');
}

function applyTheme(t: Theme): void {
  if (typeof document === 'undefined') return;
  // 'system' clears data-theme so the @media (prefers-color-scheme) rule
  // in styles.css and Tailwind's `[data-theme="dark"]` selector can both
  // observe the absence of an explicit choice and pick OS default.
  if (t === 'system') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = t;
  }
}

function applyAccent(hsl: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--accent-tenant', hsl);
}
