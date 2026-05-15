import { createRoute, redirect, Link } from '@tanstack/react-router';
import { rootRoute } from './root';
import { LoginForm } from '@/features/auth/LoginForm';
import { AuthShell } from '@/features/auth/AuthShell';
import { LoginWithPasskeyButton } from '@/features/passkeys/LoginWithPasskeyButton';
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

function LoginPage(): JSX.Element {
  return (
    <AuthShell
      title="Bun venit înapoi"
      subtitle="Conectează-te ca să-ți continui ziua. Aproape totul s-a întâmplat fără tine."
      footer={
        <>
          Nu ai cont?{' '}
          <Link
            to="/register"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Creează cont
          </Link>{' '}
          ·{' '}
          <Link
            to="/forgot-password"
            className="text-foreground underline-offset-4 hover:underline"
          >
            Ai uitat parola?
          </Link>
        </>
      }
    >
      {/*
        Passkey CTA above the email/password form. The component
        returns null when the browser doesn't support WebAuthn — so
        on unsupported browsers the user just sees the regular form,
        no clutter.

        B2-PR4: matches the rule "render the button BEFORE the
        redirect effect runs". The route-level beforeLoad already
        sends authenticated users to /app, so by the time this
        component mounts we know the user is unauthenticated.
      */}
      <LoginWithPasskeyButton />

      {/* Visual divider — only meaningful when the passkey button is
          actually rendered. Hidden via group-empty would need extra
          plumbing; we accept the small UX cost of an always-visible
          divider for unsupported browsers (it reads as a normal
          section break above the form). */}
      <div className="relative my-5">
        <div className="absolute inset-0 flex items-center" aria-hidden>
          <div className="w-full border-t border-border/60" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-background px-2 text-xs uppercase tracking-wide text-muted-foreground">
            sau folosește email + parola
          </span>
        </div>
      </div>

      <LoginForm />
    </AuthShell>
  );
}
