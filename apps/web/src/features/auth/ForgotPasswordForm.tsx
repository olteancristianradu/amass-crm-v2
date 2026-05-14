import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Mail } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ForgotPasswordFormSchema,
  type ForgotPasswordFormValues,
} from './schemas';

/**
 * Forgot-password form. Endpoint always returns 204 regardless of whether
 * the email exists, so we always render the same neutral confirmation
 * message — that's the spec, not a UX bug.
 *
 * Page-level title ("Resetare parolă") lives in AuthShell.
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
      <section
        role="status"
        aria-live="polite"
        className="w-full rounded-lg border border-border bg-card p-6"
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-md bg-secondary text-secondary-foreground">
            <Mail size={16} aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-base font-semibold leading-tight text-foreground">
              Verifică email-ul
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Dacă există un cont cu adresa indicată, ai primit un link de resetare valabil
              30 de minute.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              Nu vezi nimic? Caută în <em>Spam</em> sau încearcă din nou cu alt email.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} noValidate className="w-full space-y-5">
      <div className="space-y-1.5">
        <Label htmlFor="fp-tenant">Tenant</Label>
        <Input
          id="fp-tenant"
          placeholder="acme-srl"
          autoComplete="organization"
          className="font-mono text-xs"
          aria-invalid={errors.tenantSlug ? 'true' : undefined}
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
          placeholder="nume@firma.ro"
          aria-invalid={errors.email ? 'true' : undefined}
          {...register('email')}
        />
        {errors.email && (
          <p className="text-xs text-destructive">{errors.email.message}</p>
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
        {isSubmitting ? 'Se trimite…' : 'Trimite link de resetare'}
      </Button>
    </form>
  );
}
