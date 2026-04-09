import { createRoute, redirect } from '@tanstack/react-router';
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

function LoginPage(): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted px-4">
      <LoginForm />
    </div>
  );
}
