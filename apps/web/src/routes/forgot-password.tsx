import { createRoute, Link } from '@tanstack/react-router';
import { rootRoute } from './root';
import { AuthShell } from '@/features/auth/AuthShell';
import { ForgotPasswordForm } from '@/features/auth/ForgotPasswordForm';

export const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPasswordPage,
});

function ForgotPasswordPage(): JSX.Element {
  return (
    <AuthShell
      title="Resetare parolă"
      subtitle="Îți trimitem un link sigur, valabil 30 de minute, pentru a-ți alege o parolă nouă."
      footer={
        <Link
          to="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Înapoi la conectare
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
