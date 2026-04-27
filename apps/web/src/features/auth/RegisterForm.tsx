import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore, type AuthTokens, type AuthUser } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import { RegisterFormSchema, type RegisterFormValues } from './schemas';

/**
 * Registration card — creates a brand-new tenant + the first OWNER user
 * inside it. Backend rate-limited to 3/IP/15min.
 *
 * Successful POST returns `{ user, tokens }` (mirrors /auth/login), so we
 * can drop the user straight into /app without an extra login round-trip.
 */
export function RegisterForm(): JSX.Element {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(RegisterFormSchema),
    defaultValues: {
      tenantSlug: '',
      tenantName: '',
      fullName: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = handleSubmit(async ({ confirmPassword: _, ...payload }) => {
    setSubmitError(null);
    try {
      const res = await api.post<{ user: AuthUser; tokens: AuthTokens }>(
        '/auth/register',
        payload,
      );
      setSession(res.user, res.tokens);
      await router.navigate({ to: '/app' });
    } catch (err) {
      if (err instanceof ApiError) {
        const friendly: Record<string, string> = {
          TENANT_SLUG_TAKEN: 'Slug-ul este deja folosit. Alege altul.',
          EMAIL_TAKEN: 'Există deja un cont cu acest email.',
          VALIDATION_ERROR: 'Datele introduse sunt invalide.',
        };
        setSubmitError(friendly[err.code] ?? err.message);
      } else {
        setSubmitError('Eroare necunoscută. Încearcă din nou.');
      }
    }
  });

  return (
    <GlassCard className="w-full max-w-sm p-7">
      <header className="mb-5 flex items-start gap-3">
        <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
          <UserPlus size={18} className="text-foreground" />
        </span>
        <div>
          <h1 className="text-lg font-semibold leading-tight">Creează tenant nou</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Vei deveni proprietar (OWNER). Poți invita colegii ulterior din setări.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="r-tenant-name">Nume firmă</Label>
          <Input
            id="r-tenant-name"
            placeholder="Acme SRL"
            autoComplete="organization"
            {...register('tenantName')}
          />
          {errors.tenantName && (
            <p className="text-xs text-destructive">{errors.tenantName.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="r-tenant-slug">Slug tenant</Label>
          <Input
            id="r-tenant-slug"
            placeholder="acme-srl"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
            {...register('tenantSlug')}
          />
          <p className="text-[11px] text-muted-foreground">
            Identificator unic folosit la conectare. Doar litere mici, cifre și liniuțe.
          </p>
          {errors.tenantSlug && (
            <p className="text-xs text-destructive">{errors.tenantSlug.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="r-name">Numele tău</Label>
          <Input
            id="r-name"
            autoComplete="name"
            placeholder="Andrei Popescu"
            {...register('fullName')}
          />
          {errors.fullName && (
            <p className="text-xs text-destructive">{errors.fullName.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="r-email">Email</Label>
          <Input
            id="r-email"
            type="email"
            autoComplete="email"
            placeholder="andrei@acme.ro"
            {...register('email')}
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="r-password">Parolă</Label>
          <Input
            id="r-password"
            type="password"
            autoComplete="new-password"
            placeholder="Minim 8 caractere"
            {...register('password')}
          />
          {errors.password && (
            <p className="text-xs text-destructive">{errors.password.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="r-confirm">Confirmă parola</Label>
          <Input
            id="r-confirm"
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
          {isSubmitting ? 'Se creează…' : 'Creează cont'}
        </Button>
      </form>
    </GlassCard>
  );
}
