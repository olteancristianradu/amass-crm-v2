import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

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
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Autentificare în doi pași (2FA)</h1>

      <Card>
        <CardHeader>
          <CardTitle>Stare curentă</CardTitle>
          <CardDescription>
            2FA adaugă un strat suplimentar de securitate la contul tău. Vei avea nevoie de o
            aplicație de autentificare (Google Authenticator, Authy, etc.).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${totpEnabled ? 'bg-green-500' : 'bg-muted-foreground'}`}
            />
            <span className="text-sm font-medium">
              {totpEnabled ? '2FA este activă' : '2FA este dezactivată'}
            </span>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          {/* ── DISABLE FLOW ─────────────────────────────────────────── */}
          {totpEnabled && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                disableMut.mutate();
              }}
            >
              <p className="text-sm text-muted-foreground">
                Introdu parola curentă pentru a dezactiva 2FA.
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
                  {disableMut.isPending ? 'Se dezactivează…' : 'Dezactivează 2FA'}
                </Button>
              </div>
            </form>
          )}

          {/* ── SETUP FLOW — STEP 1: Start ───────────────────────────── */}
          {!totpEnabled && step === 'idle' && (
            <Button onClick={() => setupMut.mutate()} disabled={setupMut.isPending}>
              {setupMut.isPending ? 'Se generează…' : 'Activează 2FA'}
            </Button>
          )}

          {/* ── SETUP FLOW — STEP 2: Scan QR ────────────────────────── */}
          {!totpEnabled && step === 'scan' && qrData && (
            <div className="space-y-4">
              <p className="text-sm">
                Scanează codul QR cu aplicația ta de autentificare, apoi introdu codul de 6 cifre
                pentru confirmare.
              </p>
              <img
                src={qrData.qrDataUrl}
                alt="QR code 2FA"
                className="h-48 w-48 rounded border"
              />
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">Nu poți scana? Introdu manual</summary>
                <code className="mt-1 block break-all rounded bg-muted px-2 py-1">
                  {qrData.tempSecret}
                </code>
              </details>
              <form
                className="flex gap-2"
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
                />
                <Button type="submit" disabled={enableMut.isPending || enableCode.length !== 6}>
                  {enableMut.isPending ? 'Se verifică…' : 'Confirmă'}
                </Button>
              </form>
              <Button variant="ghost" size="sm" onClick={() => setStep('idle')}>
                Anulează
              </Button>
            </div>
          )}

          {/* ── SETUP FLOW — STEP 3: Done ───────────────────────────── */}
          {step === 'done' && (
            <p className="text-sm text-green-600 font-medium">
              ✓ 2FA a fost activată cu succes. La următorul login vei fi rugat să introduci
              codul din aplicația de autentificare.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ce este 2FA?</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Autentificarea în doi pași (2FA/TOTP) îți protejează contul chiar dacă parola este
            compromisă. La fiecare login, pe lângă parolă, vei introduce un cod de 6 cifre
            generat de o aplicație (Google Authenticator, Authy, 1Password etc.).
          </p>
          <p>
            Codul se schimbă la fiecare 30 de secunde și este unic pentru dispozitivul tău.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
