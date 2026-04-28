import { createRoute } from '@tanstack/react-router';
import { Check, Monitor, Moon, Palette, Sun, Square } from 'lucide-react';
import { authedRoute } from './authed';
import { GlassCard } from '@/components/ui/glass-card';
import { PageHeader } from '@/components/ui/page-header';
import {
  useUiPreferencesStore,
  type AccentPreset,
  type Theme,
} from '@/stores/ui-preferences';

export const settingsAppearanceRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/appearance',
  component: SettingsAppearancePage,
});

interface ThemeOption {
  value: Theme;
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  /** Mini preview tile colors. */
  swatchBg: string;
  swatchCard: string;
  swatchText: string;
}

const THEMES: ThemeOption[] = [
  {
    value: 'light',
    label: 'Liquid Glass — Lumină',
    description: 'Translucid, soft, inspirat din macOS / iPadOS. Ideal pentru ziua.',
    icon: Sun,
    swatchBg: 'hsl(220 16% 92%)',
    swatchCard: 'hsl(0 0% 100% / 0.7)',
    swatchText: 'hsl(222 47% 11%)',
  },
  {
    value: 'dark',
    label: 'Liquid Glass — Întuneric',
    description: 'Aceeași estetică, dar pe canvas închis. Confortabil seara.',
    icon: Moon,
    swatchBg: 'hsl(222 24% 8%)',
    swatchCard: 'hsl(222 24% 16% / 0.7)',
    swatchText: 'hsl(210 40% 96%)',
  },
  {
    value: 'contrast',
    label: 'High Contrast — Pro',
    description: 'Marginile clare, fără efect glass. Pentru monitoare ieftine sau lucru intens.',
    icon: Square,
    swatchBg: 'hsl(0 0% 100%)',
    swatchCard: 'hsl(0 0% 100%)',
    swatchText: 'hsl(222 47% 8%)',
  },
  {
    value: 'system',
    label: 'Urmează sistemul',
    description: 'Comută automat pe lumină/întuneric după setarea OS-ului.',
    icon: Monitor,
    swatchBg: 'linear-gradient(135deg, hsl(220 16% 92%) 50%, hsl(222 24% 8%) 50%)',
    swatchCard: 'linear-gradient(135deg, hsl(0 0% 100% / 0.7) 50%, hsl(222 24% 16% / 0.7) 50%)',
    swatchText: 'hsl(222 47% 11%)',
  },
];

interface AccentOption {
  value: AccentPreset;
  label: string;
  hsl: string;
}

const ACCENTS: AccentOption[] = [
  { value: 'default', label: 'Implicit',  hsl: '222 47% 11%' },
  { value: 'blue',    label: 'Albastru',  hsl: '217 91% 55%' },
  { value: 'purple',  label: 'Violet',    hsl: '268 78% 58%' },
  { value: 'green',   label: 'Verde',     hsl: '152 60% 42%' },
  { value: 'amber',   label: 'Chihlimbar',hsl: '32 92% 50%'  },
  { value: 'rose',    label: 'Roz',       hsl: '345 82% 58%' },
];

function SettingsAppearancePage(): JSX.Element {
  const theme = useUiPreferencesStore((s) => s.theme);
  const accentPreset = useUiPreferencesStore((s) => s.accentPreset);
  const accentTenant = useUiPreferencesStore((s) => s.accentTenant);
  const density = useUiPreferencesStore((s) => s.density);
  const setTheme = useUiPreferencesStore((s) => s.setTheme);
  const setAccentPreset = useUiPreferencesStore((s) => s.setAccentPreset);
  const setAccentTenant = useUiPreferencesStore((s) => s.setAccentTenant);
  const setDensity = useUiPreferencesStore((s) => s.setDensity);

  return (
    <div>
      <PageHeader
        title="Aspect"
        subtitle="Schimbă tema și culoarea accent. Modificările sunt vizibile imediat în întreaga aplicație."
      />

      {/* ── Themes ─────────────────────────────────────────────────────── */}
      <GlassCard className="mb-6 p-6">
        <header className="mb-4 flex items-center gap-2">
          <Palette size={16} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Temă</h2>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
              >
                {/* Mini preview tile */}
                <div
                  className="mb-3 flex h-20 w-full items-center justify-center rounded-md p-2"
                  style={{ background: opt.swatchBg }}
                >
                  <div
                    className="flex h-12 w-full items-center justify-center rounded border border-white/30 backdrop-blur-sm"
                    style={{ background: opt.swatchCard }}
                  >
                    <span
                      className="text-xs font-medium"
                      style={{ color: opt.swatchText }}
                    >
                      Aa
                    </span>
                  </div>
                </div>

                <div className="flex items-start gap-2">
                  <Icon size={14} className="mt-0.5 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{opt.label}</p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                      {opt.description}
                    </p>
                  </div>
                  {selected && (
                    <Check size={14} className="shrink-0 text-primary" />
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </GlassCard>

      {/* ── Accent ─────────────────────────────────────────────────────── */}
      <GlassCard className="mb-6 p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold">Culoare accent</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Aplicată pe inel de focus, butoane primare și elementele active. Independentă de temă.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-3">
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
            <label className="text-xs font-medium text-muted-foreground">
              Personalizat
            </label>
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

      {/* ── Density ────────────────────────────────────────────────────── */}
      <GlassCard className="p-6">
        <header className="mb-4">
          <h2 className="text-base font-semibold">Densitate</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Cât spațiu lăsăm între rânduri și butoane.
          </p>
        </header>

        <div className="flex gap-3">
          {(['comfortable', 'compact'] as const).map((d) => {
            const selected = density === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDensity(d)}
                className={`flex-1 rounded-md border p-3 text-left transition ${
                  selected
                    ? 'border-primary ring-2 ring-primary/30'
                    : 'border-border/70 hover:border-border'
                }`}
              >
                <p className="text-sm font-medium capitalize">
                  {d === 'comfortable' ? 'Confortabil' : 'Compact'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {d === 'comfortable'
                    ? 'Spațiere relaxată — implicit.'
                    : 'Mai dens cu ~15% — mai multe rânduri pe ecran.'}
                </p>
              </button>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}

// ─── Color helpers ────────────────────────────────────────────────────────

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
