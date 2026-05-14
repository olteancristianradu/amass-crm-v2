import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ResetPasswordFormSchema,
  type ResetPasswordFormValues,
} from './schemas';

/**
 * Reset-password form — confirms a token issued by /auth/password-reset/request,
 * rotates the password and revokes all existing sessions.
 *
 * Token comes in via the URL (`?token=…`), parsed at the route level. We
 * still guard against an empty/expired token by surfacing the API error.
 *
 * Page-level title ("Parolă nouă") lives in AuthShell.
 */
export function ResetPasswordForm({ token }: { token: string }): JSX.Element {
  const router = useRouter();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordFormValues>({
    resolver: zodResolver(ResetPasswordFormSchema),
    defaultValues: { newPassword: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async ({ newPassword }) => {
    setSubmitError(null);
    try {
      await api.post('/auth/password-reset/confirm', { token, newPassword });
      setDone(true);
      // Bounce to /login after a short pause so the user can read the confirmation.
      setTimeout(() => {
        void router.navigate({ to: '/login' });
      }, 1500);
    } catch (err) {
      if (err instanceof ApiError) {
        const friendly: Record<string, string> = {
          INVALID_RESET_TOKEN: 'Link-ul este invalid sau a expirat. Cere altul.',
          TOKEN_USED: 'Link-ul a fost deja folosit. Cere altul.',
        };
        setSubmitError(friendly[err.code] ?? err.message);
      } else {
        setSubmitError('Eroare necunoscută. Încearcă din nou.');
      }
    }
  });

  if (!token) {
    return (
      <section
        role="alert"
        className="w-full rounded-lg border border-destructive bg-destructive/5 p-6"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <AlertCircle size={16} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold leading-tight text-destructive">
              Token lipsă
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Acest link nu conține un token valid. Cere un nou link de resetare din ecranul
              de uitare parolă.
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (done) {
    return (
      <section
        role="status"
        aria-live="polite"
        className="w-full rounded-lg border border-border bg-card p-6"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <CheckCircle2 size={16} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold leading-tight text-foreground">
              Parola a fost actualizată
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Te ducem la pagina de conectare…
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="w-full space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="rp-new">Parolă nouă</Label>
        <Input
          id="rp-new"
          type="password"
          autoComplete="new-password"
          placeholder="Minim 8 caractere"
          aria-invalid={errors.newPassword ? 'true' : undefined}
          {...register('newPassword')}
        />
        {errors.newPassword && (
          <p className="text-xs text-destructive">{errors.newPassword.message}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="rp-confirm">Confirmă parola</Label>
        <Input
          id="rp-confirm"
          type="password"
          autoComplete="new-password"
          aria-invalid={errors.confirmPassword ? 'true' : undefined}
          {...register('confirmPassword')}
        />
        {errors.confirmPassword && (
          <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
        )}
      </div>

      {submitError && (
        <p
          role="alert"
          className="rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {submitError}
        </p>
      )}

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? 'Se salvează…' : 'Schimbă parola'}
      </Button>
    </form>
  );
}
