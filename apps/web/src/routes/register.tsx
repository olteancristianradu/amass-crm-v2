import { createRoute, redirect, Link } from '@tanstack/react-router';
import { rootRoute } from './root';
import { AuthShell } from '@/features/auth/AuthShell';
import { RegisterForm } from '@/features/auth/RegisterForm';
import { useAuthStore } from '@/stores/auth';

export const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/register',
  beforeLoad: () => {
    if (useAuthStore.getState().isAuthenticated()) {
      throw redirect({ to: '/app' });
    }
  },
  component: RegisterPage,
});

function RegisterPage(): JSX.Element {
  return (
    <AuthShell
      footer={
        <>
          Ai deja cont?{' '}
          <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
            Conectează-te
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthShell>
  );
}
