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
 * Tenant accent: an additional CSS variable `--accent-tenant` (HSL
 * triplet) lets each tenant brand the focus ring + active-pill colour
 * subtly. Defaults to the same near-black as `--primary`. Source of
 * truth in the future will be a column on the Tenant table; for now
 * stored in this same store (tenant-config endpoint not wired yet).
 */
export type Density = 'comfortable' | 'compact';

interface UiPreferencesState {
  density: Density;
  /** HSL triplet "H S% L%". Default = primary near-black. */
  accentTenant: string;
  setDensity: (d: Density) => void;
  setAccentTenant: (hsl: string) => void;
}

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      density: 'comfortable',
      accentTenant: '222 47% 11%', // matches default --primary
      setDensity: (density) => {
        set({ density });
        applyDensity(density);
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

function applyAccent(hsl: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--accent-tenant', hsl);
}
