import * as React from 'react';
import { Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';

/**
 * Shared two-column layout for the public auth routes (login / register /
 * forgot-password / reset-password). Centres the form on a wide screen and
 * keeps the right-hand brand panel identical so cross-route navigation
 * doesn't shift the eye. The actual card content is provided as `children`.
 */
export function AuthShell({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}): JSX.Element {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[1fr_minmax(0,420px)_1fr]">
      <div className="hidden md:block" />

      <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
        <Link
          to="/login"
          className="mb-6 flex items-center gap-2 text-sm text-foreground"
          aria-label="AMASS-CRM"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Sparkles size={16} />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-semibold tracking-tight">AMASS</span>
            <span className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">crm</span>
          </span>
        </Link>

        {children}

        {footer && (
          <p className="mt-6 text-center text-xs text-foreground/80">{footer}</p>
        )}
      </div>

      <aside className="hidden md:flex md:items-center md:justify-center md:px-10">
        <div className="glass-card relative max-w-sm overflow-hidden p-10">
          <div
            className="pointer-events-none absolute -top-1/2 -right-1/2 h-[200%] w-[200%] rounded-full opacity-50"
            style={{
              background:
                'radial-gradient(ellipse at center, hsl(217 91% 60% / 0.18) 0%, transparent 60%)',
            }}
          />
          <p className="relative text-sm leading-relaxed text-muted-foreground">
            CRM-ul care-ți spune ce s-a discutat în ultimul apel — fără să asculți o oră de
            înregistrare.
          </p>
          <p className="relative mt-3 text-xs uppercase tracking-[0.2em] text-muted-foreground/70">
            voice intelligence · multi-tenant · gdpr-ready
          </p>
        </div>
      </aside>
    </div>
  );
}
