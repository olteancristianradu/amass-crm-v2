import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Mail } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  ForgotPasswordFormSchema,
  type ForgotPasswordFormValues,
} from './schemas';

/**
 * Forgot-password card. Endpoint always returns 204 regardless of whether
 * the email exists, so we always render the same neutral confirmation
 * message — that's the spec, not a UX bug.
 */
export function ForgotPasswordForm(): JSX.Element {
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordFormValues>({
    resolver: zodResolver(ForgotPasswordFormSchema),
    defaultValues: { tenantSlug: '', email: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await api.post('/auth/password-reset/request', values);
      setSubmitted(true);
    } catch (err) {
      if (err instanceof ApiError) {
        // Throttling is the only error users may see — message comes back as
        // "Too many requests"; soften it.
        setSubmitError(
          err.code === 'THROTTLED'
            ? 'Prea multe încercări. Reîncearcă în câteva minute.'
            : err.message,
        );
      } else {
        setSubmitError('Eroare necunoscută. Încearcă din nou.');
      }
    }
  });

  if (submitted) {
    return (
      <GlassCard className="w-full max-w-sm p-7">
        <header className="mb-3 flex items-start gap-3">
          <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
            <Mail size={18} className="text-foreground" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Verifică email-ul</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Dacă există un cont cu adresa indicată, ai primit un link de resetare valabil
              30 de minute.
            </p>
          </div>
        </header>

        <p className="text-xs text-muted-foreground">
          Nu vezi nimic? Caută în <em>Spam</em> sau încearcă din nou cu alt email.
        </p>
      </GlassCard>
    );
  }

  return (
    <GlassCard className="w-full max-w-sm p-7">
      <header className="mb-5 flex items-start gap-3">
        <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
          <Mail size={18} className="text-foreground" />
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Resetare parolă</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Îți trimitem un link pentru a alege o parolă nouă.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="fp-tenant">Tenant</Label>
          <Input
            id="fp-tenant"
            placeholder="acme-srl"
            autoComplete="organization"
            className="font-mono text-xs"
            {...register('tenantSlug')}
          />
          {errors.tenantSlug && (
            <p className="text-xs text-destructive">{errors.tenantSlug.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="fp-email">Email</Label>
          <Input
            id="fp-email"
            type="email"
            autoComplete="email"
            {...register('email')}
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
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
          {isSubmitting ? 'Se trimite…' : 'Trimite link de resetare'}
        </Button>
      </form>
    </GlassCard>
  );
}
