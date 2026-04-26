import type { Config } from 'tailwindcss';

/**
 * Tailwind config — design system v2 (frosted glass + black accents).
 * Tokens live in `src/styles.css` as CSS custom properties so the
 * theme is hot-swappable without rebuilding utilities.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Status accent dots / chips. Used as `text-accent-blue`,
        // `bg-accent-pink/20`, etc. throughout the app.
        'accent-blue':  'hsl(var(--accent-blue))',
        'accent-pink':  'hsl(var(--accent-pink))',
        'accent-amber': 'hsl(var(--accent-amber))',
        'accent-green': 'hsl(var(--accent-green))',
      },
      borderRadius: {
        lg: 'var(--radius)',                       // 1rem (16px)
        md: 'calc(var(--radius) - 4px)',           // 12px
        sm: 'calc(var(--radius) - 8px)',           // 8px
        xl: 'calc(var(--radius) + 4px)',           // 20px
        '2xl': 'calc(var(--radius) + 12px)',       // 28px
      },
      backdropBlur: {
        glass: 'var(--surface-blur)',
      },
      boxShadow: {
        glass:
          '0 1px 0 hsl(0 0% 100% / 0.5) inset, 0 8px 24px hsl(220 30% 30% / 0.06), 0 1px 2px hsl(220 30% 30% / 0.04)',
        'glass-elev':
          '0 1px 0 hsl(0 0% 100% / 0.6) inset, 0 24px 64px hsl(220 30% 30% / 0.18), 0 4px 12px hsl(220 30% 30% / 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
