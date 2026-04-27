import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  ResetPasswordFormSchema,
  type ResetPasswordFormValues,
} from './schemas';

/**
 * Reset-password card — confirms a token issued by /auth/password-reset/request,
 * rotates the password and revokes all existing sessions.
 *
 * Token comes in via the URL (`?token=…`), parsed at the route level. We
 * still guard against an empty/expired token by surfacing the API error.
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
      <GlassCard className="w-full max-w-sm p-7">
        <h1 className="text-lg font-semibold leading-tight">Token lipsă</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Acest link nu conține un token valid. Cere un nou link de resetare.
        </p>
      </GlassCard>
    );
  }

  if (done) {
    return (
      <GlassCard className="w-full max-w-sm p-7">
        <h1 className="text-lg font-semibold leading-tight">Parola a fost actualizată</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Te ducem la pagina de conectare…
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="w-full max-w-sm p-7">
      <header className="mb-5 flex items-start gap-3">
        <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
          <KeyRound size={18} className="text-foreground" />
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Parolă nouă</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            După salvare, toate sesiunile existente vor fi revocate.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="rp-new">Parolă nouă</Label>
          <Input
            id="rp-new"
            type="password"
            autoComplete="new-password"
            placeholder="Minim 8 caractere"
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
            {...register('confirmPassword')}
          />
          {errors.confirmPassword && (
            <p className="text-xs text-destructive">{errors.confirmPassword.message}</p>
          )}
        </div>

        {submitError && (
          <p
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {submitError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Se salvează…' : 'Schimbă parola'}
        </Button>
      </form>
    </GlassCard>
  );
}
