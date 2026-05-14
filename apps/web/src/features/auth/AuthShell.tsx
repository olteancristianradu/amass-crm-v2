import * as React from 'react';
import { Link } from '@tanstack/react-router';
import { Sparkles, ShieldCheck, Languages, Lock } from 'lucide-react';

/**
 * AuthShell — split-layout chrome for all public auth routes
 * (`/login`, `/register`, `/forgot-password`, `/reset-password`).
 *
 * Layout:
 *   ┌──────────────────────────────────────────────┐
 *   │  LEFT (lg:60%)      │  RIGHT (lg:40%)        │
 *   │  • logo             │  • subtle gradient     │
 *   │  • title + caption  │  • brand stat cards    │
 *   │  • {children: form} │  • value-prop bullets  │
 *   │  • {footer}         │                        │
 *   └──────────────────────────────────────────────┘
 *
 * Below `lg:` the right panel is hidden and the form takes the full canvas.
 *
 * Design language: tokens-only ("Pragmatic Elegance" — above SugarCRM, below
 * Apple). No `bg-white/0.05` hacks; everything routes through the existing
 * HSL token scheme so dark/contrast themes inherit automatically.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="min-h-screen bg-background lg:grid lg:grid-cols-5">
      {/* ── LEFT panel: form + branding ──────────────────────────────────── */}
      <main className="flex min-h-screen flex-col px-6 py-10 sm:px-10 lg:col-span-3 lg:px-16 xl:px-24">
        <header className="flex items-center justify-between">
          <Link
            to="/login"
            className="flex items-center gap-2 text-sm text-foreground"
            aria-label="AMASS-CRM"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles size={16} aria-hidden="true" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="font-semibold tracking-tight">AMASS</span>
              <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                crm
              </span>
            </span>
          </Link>

          {/* Tiny meta strip — privacy reassurance without competing with CTA. */}
          <span className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex">
            <Lock size={12} aria-hidden="true" />
            Conexiune securizată
          </span>
        </header>

        <div className="flex flex-1 items-center">
          <div className="w-full max-w-md">
            {title && (
              <div className="mb-8">
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                  {title}
                </h1>
                {subtitle && (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {subtitle}
                  </p>
                )}
              </div>
            )}

            {children}

            {footer && (
              <p className="mt-6 text-sm text-muted-foreground">{footer}</p>
            )}
          </div>
        </div>

        <footer className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} AMASS</span>
          <a
            href="/legal/privacy"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Confidențialitate
          </a>
          <a
            href="/legal/subprocessors"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Subprocesatori
          </a>
          <a
            href="/pricing"
            className="underline-offset-4 hover:text-foreground hover:underline"
          >
            Prețuri
          </a>
        </footer>
      </main>

      {/* ── RIGHT panel: visual treatment + value props ──────────────────── */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden border-l border-border bg-card lg:col-span-2 lg:flex lg:flex-col lg:justify-center lg:px-12 xl:px-16"
      >
        {/* Layered radial gradients — refract light without opacity hacks. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: [
              'radial-gradient(ellipse 80% 60% at 20% 10%, hsl(var(--accent-blue) / 0.18) 0%, transparent 60%)',
              'radial-gradient(ellipse 70% 50% at 90% 100%, hsl(var(--accent-pink) / 0.14) 0%, transparent 60%)',
              'radial-gradient(ellipse 60% 40% at 50% 50%, hsl(var(--accent-amber) / 0.06) 0%, transparent 70%)',
            ].join(', '),
          }}
        />

        <div className="relative z-10 flex max-w-md flex-col gap-8">
          {/* Mock-up: stacked floating cards hinting at the product. */}
          <div className="relative h-44">
            <div className="absolute left-0 top-2 w-64 rounded-xl border border-border bg-background/95 p-4 shadow-lg backdrop-blur">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="status-dot status-dot--green" aria-hidden="true" />
                Apel transcris · 2 min în urmă
              </div>
              <p className="mt-2 line-clamp-2 text-sm text-foreground">
                „Clientul vrea propunere până vineri pentru pachetul Pro.”
              </p>
            </div>
            <div className="absolute left-12 top-20 w-64 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="status-dot status-dot--blue" aria-hidden="true" />
                Sumar AI · GDPR redactat
              </div>
              <p className="mt-2 text-sm text-foreground">
                3 acțiuni de urmărit · risc scăzut
              </p>
            </div>
          </div>

          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground">
            CRM-ul care îți ascultă apelurile.
          </h2>

          <ul className="space-y-4 text-sm">
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <ShieldCheck size={14} aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium text-foreground">Multi-tenant sigur</p>
                <p className="text-muted-foreground">
                  Izolare pe rând în Postgres, RLS + audit imutabil.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Languages size={14} aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium text-foreground">AI cu accent românesc</p>
                <p className="text-muted-foreground">
                  Transcriere, diarizare și sumarizare în română nativă.
                </p>
              </div>
            </li>
            <li className="flex items-start gap-3">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Lock size={14} aria-hidden="true" />
              </span>
              <div>
                <p className="font-medium text-foreground">GDPR pus la bază</p>
                <p className="text-muted-foreground">
                  Redactare PII Presidio, retenție configurabilă, export oricând.
                </p>
              </div>
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}
