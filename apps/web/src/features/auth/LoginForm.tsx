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
 * Login card. POSTs to /auth/login, drops the session in the store, then
 * navigates to /app. Surface errors inline (bad creds, tenant not found).
 */
export function LoginForm(): JSX.Element {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [submitError, setSubmitError] = useState<string | null>(null);

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
        setSubmitError(err.code === 'INVALID_CREDENTIALS' ? 'Email sau parolă incorectă' : err.message);
      } else {
        setSubmitError('Eroare necunoscută. Încearcă din nou.');
      }
    }
  });

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
