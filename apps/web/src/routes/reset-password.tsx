import { createRoute, Link } from '@tanstack/react-router';
import { z } from 'zod';
import { rootRoute } from './root';
import { AuthShell } from '@/features/auth/AuthShell';
import { ResetPasswordForm } from '@/features/auth/ResetPasswordForm';

const resetSearchSchema = z.object({ token: z.string().default('') });

export const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  validateSearch: (s) => resetSearchSchema.parse(s),
  component: ResetPasswordPage,
});

function ResetPasswordPage(): JSX.Element {
  const { token } = resetPasswordRoute.useSearch();
  return (
    <AuthShell
      footer={
        <Link to="/login" className="text-foreground underline-offset-4 hover:underline">
          Înapoi la conectare
        </Link>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthShell>
  );
}
