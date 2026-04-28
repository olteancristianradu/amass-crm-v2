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
/**
 * Theme registry:
 *   - light    : Liquid Glass Light (default — Apple-style translucent panels)
 *   - dark     : Liquid Glass Dark (deep navy + frosted glass)
 *   - contrast : High Contrast / Pro (sharp edges, opaque, Salesforce-style)
 *   - system   : follow prefers-color-scheme (light or dark only)
 */
export type Theme = 'light' | 'dark' | 'contrast' | 'system';

/**
 * Accent presets — independent of theme. Each maps to an HSL triplet
 * applied to --accent-tenant. 'custom' lets the user pick any HSL value
 * via the color picker on the settings page.
 */
export type AccentPreset = 'default' | 'blue' | 'purple' | 'green' | 'amber' | 'rose' | 'custom';

const ACCENT_PRESET_HSL: Record<Exclude<AccentPreset, 'custom'>, string> = {
  default: '222 47% 11%',  // near-black (light theme primary)
  blue:    '217 91% 55%',
  purple:  '268 78% 58%',
  green:   '152 60% 42%',
  amber:   '32 92% 50%',
  rose:    '345 82% 58%',
};

interface UiPreferencesState {
  density: Density;
  theme: Theme;
  /** Preset name. 'custom' uses `accentTenant` HSL directly. */
  accentPreset: AccentPreset;
  /** HSL triplet "H S% L%". Default = primary near-black. */
  accentTenant: string;
  setDensity: (d: Density) => void;
  setTheme: (t: Theme) => void;
  setAccentPreset: (p: AccentPreset) => void;
  setAccentTenant: (hsl: string) => void;
}

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      density: 'comfortable',
      theme: 'system',
      accentPreset: 'default',
      accentTenant: '222 47% 11%', // matches default --primary
      setDensity: (density) => {
        set({ density });
        applyDensity(density);
      },
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      setAccentPreset: (accentPreset) => {
        if (accentPreset !== 'custom') {
          const hsl = ACCENT_PRESET_HSL[accentPreset];
          set({ accentPreset, accentTenant: hsl });
          applyAccent(hsl);
        } else {
          set({ accentPreset });
        }
      },
      setAccentTenant: (accentTenant) => {
        set({ accentTenant, accentPreset: 'custom' });
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
