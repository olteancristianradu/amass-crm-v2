import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CheckCircle2, ShieldCheck, ShieldX, Smartphone } from 'lucide-react';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GlassCard } from '@/components/ui/glass-card';

export const settings2faRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/2fa',
  component: Settings2faPage,
});

interface MeResponse {
  id: string;
  totpEnabled: boolean;
}

interface SetupResponse {
  qrDataUrl: string;
  tempSecret: string;
}

/**
 * Settings → 2FA. Three flow branches:
 *   - 2FA already enabled → password-confirmed disable form
 *   - 2FA disabled, idle → "Activează" CTA → kicks the setup endpoint
 *   - 2FA disabled, scan → QR + 6-digit confirmation
 *
 * Visual layer: glass cards on the v2 design tokens. Status block at
 * the top makes the current state legible at a glance — green if
 * enabled, muted if not. Long-form prose moved to a side panel so the
 * action surface stays uncluttered.
 */
function Settings2faPage(): JSX.Element {
  const qc = useQueryClient();
  const [step, setStep] = useState<'idle' | 'scan' | 'done'>('idle');
  const [qrData, setQrData] = useState<SetupResponse | null>(null);
  const [enableCode, setEnableCode] = useState('');
  const [disablePassword, setDisablePassword] = useState('');
  const [error, setError] = useState('');

  const { data: me } = useQuery({
    queryKey: ['me-totp'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
  });

  const setupMut = useMutation({
    mutationFn: () => api.post<SetupResponse>('/auth/totp/setup'),
    onSuccess: (data) => {
      setQrData(data);
      setStep('scan');
      setError('');
    },
  });

  const enableMut = useMutation({
    mutationFn: () => api.post('/auth/totp/enable', { code: enableCode }),
    onSuccess: () => {
      setStep('done');
      setError('');
      qc.invalidateQueries({ queryKey: ['me-totp'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const disableMut = useMutation({
    // TanStack Query captures disablePassword at mutation call time via closure.
    // We use api.patch so we can send a body (DELETE + body is non-standard).
    mutationFn: () => api.patch('/auth/totp/disable', { password: disablePassword }),
    onSuccess: () => {
      setDisablePassword('');
      setError('');
      qc.invalidateQueries({ queryKey: ['me-totp'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const totpEnabled = me?.totpEnabled ?? false;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Autentificare în doi pași</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Adaugă un strat suplimentar de securitate la cont folosind o aplicație de autentificare
          (Google Authenticator, Authy, 1Password).
        </p>
      </header>

      <GlassCard className="p-6">
        {/* ── Status header ─────────────────────────────────────────── */}
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-full ${
              totpEnabled ? 'bg-accent-green/15 text-accent-green' : 'bg-secondary text-muted-foreground'
            }`}
          >
            {totpEnabled ? <ShieldCheck size={18} /> : <ShieldX size={18} />}
          </span>
          <div className="flex-1">
            <h2 className="font-medium">
              {totpEnabled ? '2FA este activă' : '2FA este dezactivată'}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {totpEnabled
                ? 'La login îți va fi cerut un cod de 6 cifre din aplicația ta de autentificare.'
                : 'Recomandă în special pentru utilizatorii OWNER și ADMIN.'}
            </p>
          </div>
        </div>

        {error && (
          <p
            role="alert"
            className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}

        {/* ── DISABLE FLOW ─────────────────────────────────────────── */}
        {totpEnabled && (
          <form
            className="mt-6 space-y-3 border-t border-border/70 pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              disableMut.mutate();
            }}
          >
            <p className="text-sm text-muted-foreground">
              Pentru a dezactiva 2FA, confirmă cu parola contului.
            </p>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Parola ta"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                required
              />
              <Button
                type="submit"
                variant="destructive"
                disabled={disableMut.isPending || !disablePassword}
              >
                {disableMut.isPending ? 'Se dezactivează…' : 'Dezactivează'}
              </Button>
            </div>
          </form>
        )}

        {/* ── SETUP FLOW — STEP 1: Start ───────────────────────────── */}
        {!totpEnabled && step === 'idle' && (
          <div className="mt-6 border-t border-border/70 pt-5">
            <Button onClick={() => setupMut.mutate()} disabled={setupMut.isPending}>
              <Smartphone size={16} className="mr-2" />
              {setupMut.isPending ? 'Se generează…' : 'Activează 2FA'}
            </Button>
          </div>
        )}

        {/* ── SETUP FLOW — STEP 2: Scan QR ────────────────────────── */}
        {!totpEnabled && step === 'scan' && qrData && (
          <div className="mt-6 space-y-4 border-t border-border/70 pt-5">
            <p className="text-sm">
              1. Scanează codul QR cu aplicația ta de autentificare. 2. Introdu codul de 6 cifre
              afișat de aplicație.
            </p>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <img
                src={qrData.qrDataUrl}
                alt="Cod QR 2FA"
                className="h-48 w-48 rounded-lg border border-border/70 bg-card p-2"
              />
              <div className="flex-1 space-y-3">
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">
                    Nu poți scana? Introdu manual
                  </summary>
                  <code className="mt-2 block break-all rounded-md border border-border/70 bg-secondary/50 px-3 py-2 text-[11px]">
                    {qrData.tempSecret}
                  </code>
                </details>

                <form
                  className="space-y-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    enableMut.mutate();
                  }}
                >
                  <Input
                    inputMode="numeric"
                    placeholder="123456"
                    maxLength={6}
                    value={enableCode}
                    onChange={(e) => setEnableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    autoFocus
                    className="text-center text-lg tracking-[0.5em] font-medium"
                  />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setStep('idle');
                        setEnableCode('');
                      }}
                    >
                      Anulează
                    </Button>
                    <Button
                      type="submit"
                      className="flex-1"
                      disabled={enableMut.isPending || enableCode.length !== 6}
                    >
                      {enableMut.isPending ? 'Se verifică…' : 'Confirmă'}
                    </Button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* ── SETUP FLOW — STEP 3: Done ───────────────────────────── */}
        {step === 'done' && (
          <div className="mt-6 flex items-start gap-3 rounded-md border border-accent-green/30 bg-accent-green/5 p-4 text-sm">
            <CheckCircle2 size={18} className="mt-0.5 text-accent-green" />
            <div>
              <p className="font-medium text-foreground">2FA activată cu succes</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                La următorul login vei fi rugat să introduci codul din aplicația de autentificare.
                Salvează codurile de rezervă într-un loc sigur.
              </p>
            </div>
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-6 text-sm text-muted-foreground">
        <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground/80">
          Ce este 2FA?
        </h2>
        <p className="mt-3">
          Autentificarea în doi pași îți protejează contul chiar dacă parola este compromisă.
          La fiecare login, pe lângă parolă, vei introduce un cod de 6 cifre generat de o aplicație
          (Google Authenticator, Authy, 1Password). Codul se schimbă la fiecare 30 de secunde.
        </p>
      </GlassCard>
    </div>
  );
}
