import { createRoute, redirect, Link } from '@tanstack/react-router';
import { rootRoute } from './root';
import { LoginForm } from '@/features/auth/LoginForm';
import { AuthShell } from '@/features/auth/AuthShell';
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
      footer={
        <>
          Nu ai cont?{' '}
          <Link to="/register" className="text-foreground underline-offset-4 hover:underline">
            Creează tenant
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
      <LoginForm />
    </AuthShell>
  );
}
