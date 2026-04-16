import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuthStore, type AuthTokens, type AuthUser } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LoginFormSchema, type LoginFormValues } from './schemas';

/**
 * Login card. Handles two-step flow:
 *   1. Tenant + email + password → if TOTP_REQUIRED, show TOTP input
 *   2. Retry same credentials + totpCode → get session tokens
 */
export function LoginForm(): JSX.Element {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // When the server returns TOTP_REQUIRED we switch to the 2FA step.
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
          // Password was correct — switch to TOTP step without showing an error.
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

  const onTotpSubmit = async (e: React.FormEvent) => {
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
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Autentificare în doi pași</CardTitle>
          <CardDescription>
            Introdu codul de 6 cifre din aplicația de autentificare.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onTotpSubmit} noValidate>
          <CardContent className="space-y-4">
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
              />
            </div>
            {submitError && (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            )}
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setTotpStep(false); setTotpCode(''); setSubmitError(null); }}
            >
              Înapoi
            </Button>
            <Button type="submit" className="flex-1" disabled={totpSubmitting || totpCode.length !== 6}>
              {totpSubmitting ? 'Se verifică…' : 'Verifică'}
            </Button>
          </CardFooter>
        </form>
      </Card>
    );
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Conectare</CardTitle>
        <CardDescription>Introdu datele contului tău AMASS-CRM</CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardContent className="space-y-4">
          <div className="space-y-2">
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
          <div className="space-y-2">
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
          <div className="space-y-2">
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
            <p role="alert" className="text-sm text-destructive">
              {submitError}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'Se conectează…' : 'Conectare'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
