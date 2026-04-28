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

interface TenantOption {
  slug: string;
  name: string;
}

/**
 * Login card. Three possible steps:
 *   1. Email + password → if TOTP_REQUIRED, show TOTP input
 *   2. Email + password → if TENANT_PICKER_REQUIRED (same email on multiple
 *      tenants), show a workspace picker, then resubmit with tenantSlug
 *   3. Retry same credentials + totpCode (if 2FA) → get session tokens
 *
 * No tenant field by default — the BE resolves the tenant from the email.
 */
export function LoginForm(): JSX.Element {
  const router = useRouter();
  const setSession = useAuthStore((s) => s.setSession);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [totpStep, setTotpStep] = useState(false);
  const [pendingValues, setPendingValues] = useState<LoginFormValues | null>(null);
  const [pendingTenantSlug, setPendingTenantSlug] = useState<string | null>(null);
  const [tenantOptions, setTenantOptions] = useState<TenantOption[] | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpSubmitting, setTotpSubmitting] = useState(false);
  const [pickerSubmitting, setPickerSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(LoginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  async function attemptLogin(values: LoginFormValues, tenantSlug?: string): Promise<void> {
    const body = tenantSlug ? { ...values, tenantSlug } : values;
    const res = await api.post<{ user: AuthUser; tokens: AuthTokens }>('/auth/login', body);
    setSession(res.user, res.tokens);
    await router.navigate({ to: '/app' });
  }

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await attemptLogin(values);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'TOTP_REQUIRED') {
          setPendingValues(values);
          setTotpStep(true);
        } else if (err.code === 'TENANT_PICKER_REQUIRED') {
          // BE returns the candidate tenants in `details.tenants` — see
          // AuthService.login. The user picks one; we resubmit explicitly.
          const tenants = (err.details as { tenants?: TenantOption[] } | undefined)?.tenants ?? [];
          setPendingValues(values);
          setTenantOptions(tenants);
        } else {
          setSubmitError(err.code === 'INVALID_CREDENTIALS' ? 'Email sau parolă incorectă' : err.message);
        }
      } else {
        setSubmitError('Eroare necunoscută. Încearcă din nou.');
      }
    }
  });

  const onPickerSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!pendingValues || !pendingTenantSlug) return;
    setSubmitError(null);
    setPickerSubmitting(true);
    try {
      await attemptLogin(pendingValues, pendingTenantSlug);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'TOTP_REQUIRED') {
          setTenantOptions(null);
          setPendingValues({ ...pendingValues });
          // Carry the chosen slug into the TOTP step.
          setPendingTenantSlug(pendingTenantSlug);
          setTotpStep(true);
        } else {
          setSubmitError(err.message ?? 'Eroare la conectare.');
        }
      } else {
        setSubmitError('Eroare necunoscută.');
      }
    } finally {
      setPickerSubmitting(false);
    }
  };

  const onTotpSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!pendingValues || totpCode.length !== 6) return;
    setSubmitError(null);
    setTotpSubmitting(true);
    try {
      const body = pendingTenantSlug
        ? { ...pendingValues, tenantSlug: pendingTenantSlug, totpCode }
        : { ...pendingValues, totpCode };
      const res = await api.post<{ user: AuthUser; tokens: AuthTokens }>('/auth/login', body);
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

  // ── Step 2a: tenant picker ────────────────────────────────────────────────
  if (tenantOptions) {
    return (
      <GlassCard className="w-full max-w-sm p-7">
        <header className="mb-5 flex items-start gap-3">
          <span className="mt-1 flex h-9 w-9 items-center justify-center rounded-full bg-secondary">
            <KeyRound size={18} className="text-foreground" />
          </span>
          <div>
            <h1 className="text-lg font-semibold leading-tight">Alege spațiul de lucru</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Adresa ta de email aparține mai multor firme. Alege unde vrei să te conectezi.
            </p>
          </div>
        </header>

        <form onSubmit={onPickerSubmit} className="space-y-4">
          <div className="space-y-2">
            {tenantOptions.map((t) => (
              <label
                key={t.slug}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 bg-secondary/20 px-3 py-2 text-sm hover:bg-secondary/40"
              >
                <input
                  type="radio"
                  name="tenant"
                  value={t.slug}
                  checked={pendingTenantSlug === t.slug}
                  onChange={() => setPendingTenantSlug(t.slug)}
                  className="accent-primary"
                />
                <span className="flex-1">
                  <span className="block font-medium">{t.name}</span>
                  <span className="block text-xs text-muted-foreground">{t.slug}</span>
                </span>
              </label>
            ))}
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
                setTenantOptions(null);
                setPendingTenantSlug(null);
                setSubmitError(null);
              }}
            >
              <ArrowLeft size={14} className="mr-1" /> Înapoi
            </Button>
            <Button type="submit" className="flex-1" disabled={pickerSubmitting || !pendingTenantSlug}>
              {pickerSubmitting ? 'Se conectează…' : 'Continuă'}
            </Button>
          </div>
        </form>
      </GlassCard>
    );
  }

  // ── Step 2b/3: TOTP step ──────────────────────────────────────────────────
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

  // ── Step 1: email + password ─────────────────────────────────────────────
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
