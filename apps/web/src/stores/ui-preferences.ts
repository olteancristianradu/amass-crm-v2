import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * UI preferences store — drives every customizable surface in the app.
 *
 * Each preference maps to a single `data-*` attribute on <html>, and
 * styles.css reads those attributes to swap CSS custom properties.
 * That keeps the runtime cost ~zero (no React re-render on theme
 * switch — just an attribute mutation that the browser repaints once)
 * and lets us preview themes without remounting the component tree.
 *
 * Preferences are orthogonal: any theme combines with any density,
 * any radius, any font, any motion, any accent. The settings page
 * surfaces this matrix to the user — see settings.appearance.page.tsx.
 *
 * Persistence: Zustand `persist` middleware writes the whole state to
 * `localStorage` under `amass-ui-prefs`. On rehydrate we re-apply every
 * preference to <html> so the page paints with the user's choices on
 * the very first frame after hydration (no flash of default theme).
 */

/**
 * Density — three levels bracket the default.
 *   compact (~0.82×)     : Salesforce-style dense rows for data agents
 *   comfortable (1×)     : default
 *   spacious (~1.18×)    : Apple-style generous whitespace
 */
export type Density = 'compact' | 'comfortable' | 'spacious';

/**
 * Theme registry. Three "primary" families, each tuned for a different
 * mental model:
 *
 *   Liquid Glass    : light / dark — Apple-inspired translucent panels
 *   High Contrast   : contrast      — Salesforce-Lightning, opaque, sharp
 *   Editorial       : editorial-light / editorial-dark — Stripe/Linear flat
 *   Mocha / Forest / Sunset / Nordic / Carbon — accent-led brand variants
 *   System          : follow prefers-color-scheme
 */
export type Theme =
  | 'light'
  | 'dark'
  | 'contrast'
  | 'editorial-light'
  | 'editorial-dark'
  | 'mocha'
  | 'forest'
  | 'sunset'
  | 'nordic'
  | 'carbon'
  | 'system';

/** Radius override — `default` defers to the active theme's --radius. */
export type RadiusPreset = 'sharp' | 'default' | 'soft' | 'round';

/** Font family. Loaded from OS stacks (no web-font dep). */
export type FontPreset = 'system' | 'serif' | 'mono' | 'rounded';

/**
 * Motion preference.
 *   full    : honor every animation
 *   reduced : keep state-change feedback at ~1 RAF
 *   off     : strip animation + transition entirely
 * `prefers-reduced-motion: reduce` overrides to reduced unless user
 * explicitly picked 'full'.
 */
export type MotionPreset = 'full' | 'reduced' | 'off';

/**
 * Accent presets — each maps to an HSL triplet applied to --accent-tenant.
 * 'default' uses the active theme's natural primary (kept identical to the
 * previous behavior so existing tenant overrides still resolve). 'custom'
 * lets users pick any HSL via the color picker on the settings page.
 */
export type AccentPreset =
  | 'default'
  | 'blue'
  | 'cyan'
  | 'emerald'
  | 'violet'
  | 'rose'
  | 'amber'
  | 'orange'
  | 'purple'
  | 'green'
  | 'custom';

const ACCENT_PRESET_HSL: Record<Exclude<AccentPreset, 'custom' | 'default'>, string> = {
  blue:    '217 91% 55%',
  cyan:    '189 94% 43%',
  emerald: '152 60% 42%',
  violet:  '268 78% 58%',
  rose:    '345 82% 58%',
  amber:   '32 92% 50%',
  orange:  '24 95% 53%',
  // legacy aliases (kept so persisted state from older builds doesn't break)
  purple:  '268 78% 58%',
  green:   '152 60% 42%',
};

/** Default HSL when accent === 'default'. Falls back to near-black. */
const DEFAULT_ACCENT_HSL = '222 47% 11%';

interface UiPreferencesState {
  density: Density;
  theme: Theme;
  radius: RadiusPreset;
  font: FontPreset;
  motion: MotionPreset;
  /** Preset name. 'custom' uses `accentTenant` HSL directly. */
  accentPreset: AccentPreset;
  /** HSL triplet "H S% L%". */
  accentTenant: string;
  setDensity: (d: Density) => void;
  setTheme: (t: Theme) => void;
  setRadius: (r: RadiusPreset) => void;
  setFont: (f: FontPreset) => void;
  setMotion: (m: MotionPreset) => void;
  setAccentPreset: (p: AccentPreset) => void;
  setAccentTenant: (hsl: string) => void;
}

export const useUiPreferencesStore = create<UiPreferencesState>()(
  persist(
    (set) => ({
      density: 'comfortable',
      theme: 'system',
      radius: 'default',
      font: 'system',
      motion: 'full',
      accentPreset: 'default',
      accentTenant: DEFAULT_ACCENT_HSL,
      setDensity: (density) => {
        set({ density });
        applyDensity(density);
      },
      setTheme: (theme) => {
        set({ theme });
        applyTheme(theme);
      },
      setRadius: (radius) => {
        set({ radius });
        applyRadius(radius);
      },
      setFont: (font) => {
        set({ font });
        applyFont(font);
      },
      setMotion: (motion) => {
        set({ motion });
        applyMotion(motion);
      },
      setAccentPreset: (accentPreset) => {
        if (accentPreset === 'custom') {
          set({ accentPreset });
          return;
        }
        if (accentPreset === 'default') {
          set({ accentPreset, accentTenant: DEFAULT_ACCENT_HSL });
          applyAccent(DEFAULT_ACCENT_HSL);
          return;
        }
        const hsl = ACCENT_PRESET_HSL[accentPreset];
        set({ accentPreset, accentTenant: hsl });
        applyAccent(hsl);
      },
      setAccentTenant: (accentTenant) => {
        set({ accentTenant, accentPreset: 'custom' });
        applyAccent(accentTenant);
      },
    }),
    {
      name: 'amass-ui-prefs',
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        applyDensity(state.density);
        applyTheme(state.theme);
        applyRadius(state.radius);
        applyFont(state.font);
        applyMotion(state.motion);
        applyAccent(state.accentTenant);
      },
    },
  ),
);

// ─── DOM appliers ─────────────────────────────────────────────────────
// Each preference owns a single data-* attribute on <html>. styles.css
// is the source of truth for what each attribute swaps. We also write
// the legacy inline --density-scale because parts of the codebase still
// read it directly (component-layer utilities in styles.css).

function applyDensity(d: Density): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.density = d;
  const scale = d === 'compact' ? '0.82' : d === 'spacious' ? '1.18' : '1';
  document.documentElement.style.setProperty('--density-scale', scale);
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

function applyRadius(r: RadiusPreset): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.radius = r;
}

function applyFont(f: FontPreset): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.font = f;
}

function applyMotion(m: MotionPreset): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.motion = m;
}

function applyAccent(hsl: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.style.setProperty('--accent-tenant', hsl);
}

/**
 * Imperative one-shot applier — useful for tests / SSR hydration paths
 * that bypass the Zustand `onRehydrateStorage` callback. Reads current
 * state and writes every data-* attribute. Safe to call multiple times.
 */
export function applyAllUiPreferences(): void {
  const s = useUiPreferencesStore.getState();
  applyDensity(s.density);
  applyTheme(s.theme);
  applyRadius(s.radius);
  applyFont(s.font);
  applyMotion(s.motion);
  applyAccent(s.accentTenant);
}
