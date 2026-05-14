import * as React from 'react';
import {
  Check,
  Monitor,
  Moon,
  Palette,
  Sun,
  Square,
  Type as TypeIcon,
  Sparkles,
  Gauge,
  CornerDownRight,
  Zap,
} from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PageHeader } from '@/components/ui/page-header';
import {
  useUiPreferencesStore,
  applyAllUiPreferences,
  type AccentPreset,
  type Density,
  type FontPreset,
  type MotionPreset,
  type RadiusPreset,
  type Theme,
} from '@/stores/ui-preferences';

/* ─── Theme catalogue ────────────────────────────────────────────────
 * Each theme renders a tiny live preview inside the picker so the user
 * sees the actual canvas/card/text colors before committing — the
 * `theme-preview` div sets `data-theme` on itself, which scopes the
 * CSS-variable swap to just that preview, not the whole page.
 *
 * `family` groups themes that are visually related, used for the
 * section headings ("Liquid Glass", "High Contrast", "Editorial", ...).
 */
interface ThemeOption {
  value: Theme;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  family: string;
}

const THEMES: ThemeOption[] = [
  {
    value: 'system',
    label: 'Urmează sistemul',
    description: 'Comută automat între luminoasă și întunecată după OS.',
    icon: Monitor,
    family: 'Auto',
  },
  {
    value: 'light',
    label: 'Liquid Glass — Lumină',
    description: 'Translucid, soft, inspirat din macOS / iPadOS.',
    icon: Sun,
    family: 'Liquid Glass',
  },
  {
    value: 'dark',
    label: 'Liquid Glass — Întuneric',
    description: 'Aceeași estetică glass, dar pe canvas închis.',
    icon: Moon,
    family: 'Liquid Glass',
  },
  {
    value: 'contrast',
    label: 'High Contrast — Pro',
    description: 'Margini clare, fără glass. Pentru monitoare ieftine sau lucru intens.',
    icon: Square,
    family: 'High Contrast',
  },
  {
    value: 'editorial-light',
    label: 'Editorial — Lumină',
    description: 'Hârtie caldă, cerneală închisă. Plat, lizibil, fără efecte.',
    icon: Sun,
    family: 'Editorial',
  },
  {
    value: 'editorial-dark',
    label: 'Editorial — Întuneric',
    description: 'Cărbune cald + alb cremă. Mod de citire fără glass.',
    icon: Moon,
    family: 'Editorial',
  },
  {
    value: 'mocha',
    label: 'Mocha',
    description: 'Cremă + maro cald. Cozy, B2C, brand boutique.',
    icon: Sparkles,
    family: 'Brand',
  },
  {
    value: 'forest',
    label: 'Pădure',
    description: 'Verde pal + verde adânc. Sustenabilitate, agritech, outdoor.',
    icon: Sparkles,
    family: 'Brand',
  },
  {
    value: 'sunset',
    label: 'Apus',
    description: 'Piersică + portocaliu. Agenții creative, lifestyle.',
    icon: Sparkles,
    family: 'Brand',
  },
  {
    value: 'nordic',
    label: 'Nordic',
    description: 'Albastru frost + bleumarin. Fintech, SaaS, consulting.',
    icon: Sparkles,
    family: 'Brand',
  },
  {
    value: 'carbon',
    label: 'Carbon',
    description: 'Negru pur + cyan neon. Power-user, developer, cyberpunk.',
    icon: Zap,
    family: 'Brand',
  },
];

/* ─── Accent swatches ──────────────────────────────────────────────── */
interface AccentOption {
  value: AccentPreset;
  label: string;
  hsl: string;
}

const ACCENTS: AccentOption[] = [
  { value: 'default', label: 'Implicit',   hsl: '222 47% 11%' },
  { value: 'blue',    label: 'Albastru',   hsl: '217 91% 55%' },
  { value: 'cyan',    label: 'Cyan',       hsl: '189 94% 43%' },
  { value: 'emerald', label: 'Smarald',    hsl: '152 60% 42%' },
  { value: 'violet',  label: 'Violet',     hsl: '268 78% 58%' },
  { value: 'rose',    label: 'Roz',        hsl: '345 82% 58%' },
  { value: 'amber',   label: 'Chihlimbar', hsl: '32 92% 50%'  },
  { value: 'orange',  label: 'Portocaliu', hsl: '24 95% 53%'  },
];

/* ─── Density / Radius / Font / Motion option cards ────────────────── */
interface OptionCard<V extends string> {
  value: V;
  label: string;
  description: string;
}

const DENSITY_OPTIONS: OptionCard<Density>[] = [
  { value: 'compact',     label: 'Compact',     description: 'Dens, ~18% mai strâns. Mai multe rânduri vizibile.' },
  { value: 'comfortable', label: 'Confortabil', description: 'Spațiere implicită, echilibrată.' },
  { value: 'spacious',    label: 'Aerisit',     description: '~18% mai relaxat. Stil Apple, generos.' },
];

const RADIUS_OPTIONS: OptionCard<RadiusPreset>[] = [
  { value: 'sharp',   label: 'Ascuțit',  description: 'Colțuri reci, ~4px.' },
  { value: 'default', label: 'Implicit', description: 'Rotunjire dată de temă.' },
  { value: 'soft',    label: 'Moale',    description: 'Rotunjit mediu, ~12px.' },
  { value: 'round',   label: 'Rotund',   description: 'Foarte rotunjit, ~20px.' },
];

const FONT_OPTIONS: OptionCard<FontPreset>[] = [
  { value: 'system',  label: 'Sistem',     description: 'Fontul nativ al OS-ului.' },
  { value: 'serif',   label: 'Cu serife',  description: 'Iowan / Baskerville. Editorial, lectură lungă.' },
  { value: 'mono',    label: 'Monospațiat', description: 'SF Mono. Power-user, log-uri, date tabulare.' },
  { value: 'rounded', label: 'Rotunjit',   description: 'SF Pro Rounded / Nunito. Cald, prietenos.' },
];

const MOTION_OPTIONS: OptionCard<MotionPreset>[] = [
  { value: 'full',    label: 'Complet',    description: 'Toate animațiile active.' },
  { value: 'reduced', label: 'Redus',      description: 'Doar feedback la state-change. Recomandat sensibilități vestibulare.' },
  { value: 'off',     label: 'Oprit',      description: 'Fără animații sau tranziții.' },
];

/* ─── Page ─────────────────────────────────────────────────────────── */
export function SettingsAppearancePage(): JSX.Element {
  const theme        = useUiPreferencesStore((s) => s.theme);
  const density      = useUiPreferencesStore((s) => s.density);
  const radius       = useUiPreferencesStore((s) => s.radius);
  const font         = useUiPreferencesStore((s) => s.font);
  const motion       = useUiPreferencesStore((s) => s.motion);
  const accentPreset = useUiPreferencesStore((s) => s.accentPreset);
  const accentTenant = useUiPreferencesStore((s) => s.accentTenant);

  const setTheme        = useUiPreferencesStore((s) => s.setTheme);
  const setDensity      = useUiPreferencesStore((s) => s.setDensity);
  const setRadius       = useUiPreferencesStore((s) => s.setRadius);
  const setFont         = useUiPreferencesStore((s) => s.setFont);
  const setMotion       = useUiPreferencesStore((s) => s.setMotion);
  const setAccentPreset = useUiPreferencesStore((s) => s.setAccentPreset);
  const setAccentTenant = useUiPreferencesStore((s) => s.setAccentTenant);

  // On mount: replay every preference to <html>. Belt-and-suspenders
  // for code paths that bypass `onRehydrateStorage` (StrictMode double-
  // mount, HMR reload, tests). Cheap: it's just attribute writes.
  React.useEffect(() => {
    applyAllUiPreferences();
  }, []);

  return (
    <div>
      <PageHeader
        title="Aspect"
        subtitle="Personalizează tema, densitatea, rotunjirea, fontul, mișcarea și culoarea de accent. Modificările sunt vizibile imediat."
      />

      {/* ── Theme ──────────────────────────────────────────────────── */}
      <GlassCard className="mb-6 p-6">
        <header className="mb-4 flex items-center gap-2">
          <Palette size={16} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Temă</h2>
        </header>

        <div className="grid gap-3 sm:grid-cols-2">
          {THEMES.map((opt) => {
            const Icon = opt.icon;
            const selected = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                className={`group relative overflow-hidden rounded-lg border p-3 text-left transition ${
                  selected
                    ? 'border-primary ring-2 ring-primary/40'
                    : 'border-border/70 hover:border-border'
                }`}
                aria-pressed={selected}
              >
                <ThemePreview themeValue={opt.value} />

                <div className="mt-3 flex items-start gap-2">
                  <Icon size={14} className="mt-0.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-medium">{opt.label}</p>
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
                        {opt.family}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {opt.description}
                    </p>
                  </div>
                  {selected && <Check size={14} className="shrink-0 text-primary" />}
                </div>
              </button>
            );
          })}
        </div>
      </GlassCard>

      {/* ── Accent ─────────────────────────────────────────────────── */}
      <GlassCard className="mb-6 p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold">Culoare accent</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Aplicată pe inelul de focus, butoanele primare și elementele active. Independentă de temă.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          {ACCENTS.map((opt) => {
            const selected = accentPreset === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setAccentPreset(opt.value)}
                className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${
                  selected
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border/70 bg-card hover:border-border'
                }`}
                aria-pressed={selected}
              >
                <span
                  className="h-3 w-3 rounded-full ring-1 ring-border/40"
                  style={{ background: `hsl(${opt.hsl})` }}
                />
                {opt.label}
              </button>
            );
          })}

          {/* Custom HEX picker */}
          <div className="flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1.5">
            <span
              className="h-3 w-3 rounded-full ring-1 ring-border/40"
              style={{ background: `hsl(${accentTenant})` }}
            />
            <label className="text-xs font-medium text-muted-foreground">Personalizat</label>
            <input
              type="color"
              aria-label="Culoare personalizată"
              value={hslToHex(accentTenant)}
              onChange={(e) => setAccentTenant(hexToHsl(e.target.value))}
              className="h-5 w-7 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </div>
        </div>
      </GlassCard>

      {/* ── Density ────────────────────────────────────────────────── */}
      <GlassCard className="mb-6 p-6">
        <header className="mb-4 flex items-center gap-2">
          <Gauge size={16} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Densitate</h2>
        </header>

        <CardChooser
          options={DENSITY_OPTIONS}
          value={density}
          onChange={setDensity}
        />
      </GlassCard>

      {/* ── Radius ─────────────────────────────────────────────────── */}
      <GlassCard className="mb-6 p-6">
        <header className="mb-4 flex items-center gap-2">
          <CornerDownRight size={16} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Rotunjire colțuri</h2>
        </header>

        <CardChooser
          options={RADIUS_OPTIONS}
          value={radius}
          onChange={setRadius}
          renderPreview={(opt) => (
            <div
              className="mb-2 h-6 w-full border border-border/70 bg-secondary"
              style={{ borderRadius: radiusPreviewPx(opt.value) }}
            />
          )}
        />
      </GlassCard>

      {/* ── Font ───────────────────────────────────────────────────── */}
      <GlassCard className="mb-6 p-6">
        <header className="mb-4 flex items-center gap-2">
          <TypeIcon size={16} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Familie de font</h2>
        </header>

        <CardChooser
          options={FONT_OPTIONS}
          value={font}
          onChange={setFont}
          renderPreview={(opt) => (
            <div
              className="mb-2 flex h-10 items-center justify-center rounded-md border border-border/70 bg-secondary text-lg font-medium"
              style={{ fontFamily: fontPreviewStack(opt.value) }}
            >
              Aa
            </div>
          )}
        />
      </GlassCard>

      {/* ── Motion ─────────────────────────────────────────────────── */}
      <GlassCard className="p-6">
        <header className="mb-4 flex items-center gap-2">
          <Zap size={16} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Mișcare</h2>
        </header>

        <CardChooser
          options={MOTION_OPTIONS}
          value={motion}
          onChange={setMotion}
        />
      </GlassCard>
    </div>
  );
}

/* ─── ThemePreview ───────────────────────────────────────────────────
 * Self-scoping preview: sets data-theme on its own root so CSS-variable
 * tokens evaluate against the previewed theme, not the host page's
 * active theme. Renders a stripped-down canvas + card + button + text
 * to convey the look in ~120×80px.
 */
function ThemePreview({ themeValue }: { themeValue: Theme }): JSX.Element {
  // For 'system' we draw a split-tile to convey both light/dark sides.
  if (themeValue === 'system') {
    return (
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border/40">
        <PreviewBody theme="light" half />
        <PreviewBody theme="dark" half />
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-md border border-border/40">
      <PreviewBody theme={themeValue} />
    </div>
  );
}

function PreviewBody({
  theme,
  half = false,
}: {
  theme: Exclude<Theme, 'system'>;
  half?: boolean;
}): JSX.Element {
  return (
    <div
      // The `theme-preview` class is just a marker; the data-theme
      // attribute is what re-binds the CSS custom properties via the
      // selectors in styles.css. Width/height are constrained to keep
      // the preview compact regardless of the chosen radius.
      className="theme-preview flex h-20 w-full flex-col items-stretch justify-between p-2"
      data-theme={theme}
      style={{
        background: 'hsl(var(--background))',
        color: 'hsl(var(--foreground))',
        borderRight: half ? '1px solid hsl(var(--border))' : undefined,
      }}
    >
      <div
        className="flex items-center gap-1 rounded p-1 text-[9px]"
        style={{
          background: 'hsl(var(--card) / var(--surface-alpha))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 'var(--radius)',
        }}
      >
        <span style={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}>Aa</span>
        <span style={{ color: 'hsl(var(--muted-foreground))' }}>text</span>
      </div>
      <div className="flex items-center justify-between">
        <span
          className="text-[9px] font-medium"
          style={{
            background: 'hsl(var(--primary))',
            color: 'hsl(var(--primary-foreground))',
            padding: '2px 6px',
            borderRadius: 'var(--radius)',
          }}
        >
          OK
        </span>
        <span
          className="h-2 w-2 rounded-full"
          style={{ background: 'hsl(var(--accent-blue))' }}
        />
      </div>
    </div>
  );
}

/* ─── CardChooser ────────────────────────────────────────────────────
 * Generic card-grid radio. Lifted out because density / radius / font /
 * motion all share the same visual pattern. `renderPreview` is optional
 * so simple choosers (motion) skip the preview row entirely.
 */
function CardChooser<V extends string>({
  options,
  value,
  onChange,
  renderPreview,
}: {
  options: OptionCard<V>[];
  value: V;
  onChange: (v: V) => void;
  renderPreview?: (opt: OptionCard<V>) => React.ReactNode;
}): JSX.Element {
  return (
    <div className={`grid gap-2 ${options.length >= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-3'}`}>
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`rounded-md border p-3 text-left transition ${
              selected
                ? 'border-primary ring-2 ring-primary/30'
                : 'border-border/70 hover:border-border'
            }`}
            aria-pressed={selected}
          >
            {renderPreview?.(opt)}
            <p className="text-sm font-medium">{opt.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{opt.description}</p>
          </button>
        );
      })}
    </div>
  );
}

/* ─── Preview helpers ────────────────────────────────────────────── */

/** Translate radius preset to a concrete CSS value for previews only.
 *  The live token swap is handled by styles.css; this is just so the
 *  thumbnail visibly differs between sharp/default/soft/round. */
function radiusPreviewPx(r: RadiusPreset): string {
  switch (r) {
    case 'sharp':   return '4px';
    case 'default': return '12px';
    case 'soft':    return '16px';
    case 'round':   return '24px';
  }
}

/** Inline font stack for previews. Mirrors the CSS rules in styles.css
 *  so users see the same family in the picker as they'll get globally. */
function fontPreviewStack(f: FontPreset): string {
  switch (f) {
    case 'system':
      return "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    case 'serif':
      return "'Iowan Old Style', 'Apple Garamond', Baskerville, 'Times New Roman', 'Droid Serif', Times, 'Source Serif Pro', serif";
    case 'mono':
      return "'SF Mono', ui-monospace, 'Cascadia Mono', 'Roboto Mono', Menlo, Consolas, monospace";
    case 'rounded':
      return "'SF Pro Rounded', 'Nunito', ui-rounded, 'Hiragino Maru Gothic ProN', Quicksand, 'Comfortaa', sans-serif";
  }
}

// ─── Color helpers ────────────────────────────────────────────────────

/** "H S% L%" → "#rrggbb" for the <input type="color"> picker. */
function hslToHex(hsl: string): string {
  const parts = hsl.match(/(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%/);
  if (!parts) return '#000000';
  const h = parseFloat(parts[1]) / 360;
  const s = parseFloat(parts[2]) / 100;
  const l = parseFloat(parts[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** "#rrggbb" → "H S% L%" so the store keeps the same shape. */
function hexToHsl(hex: string): string {
  const m = hex.replace('#', '').match(/.{2}/g);
  if (!m) return '0 0% 0%';
  const [r, g, b] = m.map((s) => parseInt(s, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}
