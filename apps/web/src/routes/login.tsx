import { createRoute, redirect, Link } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { rootRoute } from './root';
import { LoginForm } from '@/features/auth/LoginForm';
import { useAuthStore } from '@/stores/auth';

/**
 * Public /login route. If the user already has a valid session in the
 * store, bounce them straight into /app. This runs BEFORE the component
 * mounts so there's no brief "login page flash".
 */
export const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: () => {
    if (useAuthStore.getState().isAuthenticated()) {
      throw redirect({ to: '/app' });
    }
  },
  component: LoginPage,
});

/**
 * Two-column login page. Left = form on glass card; right (hidden on
 * mobile) = brand panel with a soft gradient backdrop. The whole page
 * sits on the same body gradient as the authenticated app, so the
 * cross-fade feels continuous after sign-in.
 */
function LoginPage(): JSX.Element {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[1fr_minmax(0,420px)_1fr]">
      {/* Left filler — keeps the form centred on a wide screen */}
      <div className="hidden md:block" />

      {/* Form column */}
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

        <LoginForm />

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Probleme la conectare?{' '}
          <a href="mailto:support@amass.ro" className="text-foreground underline-offset-4 hover:underline">
            support@amass.ro
          </a>
        </p>
      </div>

      {/* Right rail — only visible on lg+ screens. Stays subtle: no
          marketing copy, no testimonials. The gradient panel + a single
          quote keeps the feel "calm enterprise". */}
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
