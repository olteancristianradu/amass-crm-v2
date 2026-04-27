import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore, type AuthTokens, type AuthUser } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import { LoginFormSchema, type LoginFormValues } from './schemas';

/**
 * Login card. Two-step flow:
 *   1. Tenant + email + password → if TOTP_REQUIRED, show TOTP input
 *   2. Retry same credentials + totpCode → get session tokens
 *
 * Visual style: glass card on the v2 design tokens. No drop shadows
 * outside of the GlassCard's own subtle elevation. Errors render under
 * the relevant field; account-locked errors bounce the user back to
 * the password step so the lockout TTL message is visible.
 */
export function LoginForm(): JSX.Element {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [totpStep, setTotpStep] = useState(false);
  const [pendingValues, setPendingValues] = useState<LoginFormValues | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpSubmitting, setTotpSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(LoginFormSchema),
    defaultValues: { tenantSlug: '', email: '', password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      const res = await api.post<{ user: AuthUser; tokens: AuthTokens }>('/auth/login', values);
      setSession(res.user, res.tokens);
      await router.navigate({ to: '/app' });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'TOTP_REQUIRED') {
          setPendingValues(values);
          setTotpStep(true);
        } else {
          setSubmitError(err.code === 'INVALID_CREDENTIALS' ? 'Email sau parolă incorectă' : err.message);
        }
      } else {
        setSubmitError('Eroare necunoscută. Încearcă din nou.');
      }
    }
  });

  const onTotpSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!pendingValues || totpCode.length !== 6) return;
    setSubmitError(null);
    setTotpSubmitting(true);
    try {
      const res = await api.post<{ user: AuthUser; tokens: AuthTokens }>('/auth/login', {
        ...pendingValues,
        totpCode,
      });
      setSession(res.user, res.tokens);
      await router.navigate({ to: '/app' });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'ACCOUNT_LOCKED') {
          setSubmitError(err.message);
          setTotpStep(false);
        } else {
          setSubmitError('Cod incorect. Încearcă din nou.');
        }
      } else {
        setSubmitError('Eroare necunoscută. Încearcă din nou.');
      }
    } finally {
      setTotpSubmitting(false);
    }
  };

  if (totpStep) {
    return (
      <GlassCard className="w-full max-w-sm p-7">
        <header className="mb-5 flex items-start gap-3">
          <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
            <ShieldCheck size={18} className="text-foreground" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Autentificare în doi pași</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Introdu codul de 6 cifre din aplicația de autentificare.
            </p>
          </div>
        </header>

        <form onSubmit={onTotpSubmit} noValidate className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="totp-code">Cod 2FA</Label>
            <Input
              id="totp-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              placeholder="123456"
              maxLength={6}
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              className="text-center text-lg tracking-[0.5em] font-medium"
            />
            <p className="text-[11px] text-muted-foreground">
              Sau folosește un cod de rezervă (8 caractere) dacă ai pierdut accesul la aplicație.
            </p>
          </div>

          {submitError && (
            <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {submitError}
            </p>
          )}

          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setTotpStep(false);
                setTotpCode('');
                setSubmitError(null);
              }}
            >
              <ArrowLeft size={14} className="mr-1" /> Înapoi
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={totpSubmitting || totpCode.length !== 6}
            >
              {totpSubmitting ? 'Se verifică…' : 'Verifică'}
            </Button>
          </div>
        </form>
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
          <h1 className="text-lg font-semibold leading-tight">Conectare</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Introdu datele contului tău pentru a continua.
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="tenantSlug">Tenant</Label>
          <Input
            id="tenantSlug"
            autoComplete="organization"
            placeholder="ex: acme-srl"
            {...register('tenantSlug')}
          />
          {errors.tenantSlug && (
            <p className="text-xs text-destructive">{errors.tenantSlug.message}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="nume@firma.ro"
            {...register('email')}
          />
          {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="password">Parolă</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            {...register('password')}
          />
          {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
        </div>

        {submitError && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {submitError}
          </p>
        )}

        <Button type="submit" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Se conectează…' : 'Conectare'}
        </Button>
      </form>
    </GlassCard>
  );
}
