import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CheckCircle2, Copy, Download, KeyRound, ShieldCheck, ShieldX, Smartphone } from 'lucide-react';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { GlassCard } from '@/components/ui/glass-card';
import { PageHeader } from '@/components/ui/page-header';

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

interface EnableResponse {
  message: string;
  backupCodes: string[];
}

interface BackupCodesRemainingResponse {
  remaining: number;
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
  const [regenPassword, setRegenPassword] = useState('');
  const [error, setError] = useState('');
  // B2-PR5: holds the freshly-issued backup codes from enable() or
  // regenerateBackupCodes(). Surfaced in a panel that the user MUST
  // dismiss (the codes are shown ONCE — the BE stores only SHA-256
  // hashes, so if you close without saving you're locked out of the
  // recovery path until you regenerate).
  const [freshCodes, setFreshCodes] = useState<string[] | null>(null);

  const { data: me } = useQuery({
    queryKey: ['me-totp'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
  });

  const { data: remaining } = useQuery({
    queryKey: ['totp-backup-codes-remaining'],
    queryFn: () => api.get<BackupCodesRemainingResponse>('/auth/totp/backup-codes/remaining'),
    // Only fetch when 2FA is enabled — otherwise the endpoint returns {remaining: 0}.
    enabled: me?.totpEnabled === true,
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
    mutationFn: () => api.post<EnableResponse>('/auth/totp/enable', { code: enableCode }),
    onSuccess: (data) => {
      setStep('done');
      setError('');
      setFreshCodes(data.backupCodes);
      qc.invalidateQueries({ queryKey: ['me-totp'] });
      qc.invalidateQueries({ queryKey: ['totp-backup-codes-remaining'] });
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

  const regenerateMut = useMutation({
    mutationFn: () =>
      api.post<{ backupCodes: string[] }>('/auth/totp/backup-codes/regenerate', {
        password: regenPassword,
      }),
    onSuccess: (data) => {
      setFreshCodes(data.backupCodes);
      setRegenPassword('');
      setError('');
      qc.invalidateQueries({ queryKey: ['totp-backup-codes-remaining'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const totpEnabled = me?.totpEnabled ?? false;

  // Helpers for the codes panel — clipboard + download .txt. No external
  // deps; both are vanilla browser APIs available everywhere we ship.
  const copyCodes = async (codes: string[]) => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
    } catch {
      // Clipboard API can fail under HTTP or in iframes; the visible UI
      // still shows the codes so the user can copy manually.
    }
  };
  const downloadCodes = (codes: string[]) => {
    const blob = new Blob(
      [
        `Coduri de rezervă 2FA — Amass CRM\nGenerate la ${new Date().toLocaleString('ro-RO')}\n\n${codes.join('\n')}\n\nFiecare cod e valid o singură dată. Păstrează acest fișier în siguranță.\n`,
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `amass-2fa-backup-codes-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Autentificare în doi pași"
        subtitle="Configurează 2FA pentru contul tău."
      />

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
                Vezi codurile de rezervă mai jos — salvează-le acum.
              </p>
            </div>
          </div>
        )}
      </GlassCard>

      {/* ── BACKUP CODES PANEL (B2-PR5) ─────────────────────────────
          Shown immediately after enable() or regenerate(). The codes
          are visible exactly once — BE stores only SHA-256 hashes —
          so we force the user to acknowledge before dismissing.
       */}
      {freshCodes && freshCodes.length > 0 && (
        <GlassCard className="border-accent-amber/40 bg-accent-amber/5 p-6">
          <div className="flex items-start gap-3">
            <KeyRound size={20} className="mt-1 text-accent-amber" />
            <div className="flex-1">
              <h2 className="font-medium text-foreground">Codurile tale de rezervă</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Fiecare cod e valid o singură dată — folosește-le dacă pierzi accesul
                la aplicația de autentificare. <strong>Salvează-le acum:</strong> nu
                vor mai fi vizibile după ce închizi acest panou.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-border/70 bg-background/60 p-4 font-mono text-sm">
                {freshCodes.map((code) => (
                  <code key={code} className="select-all">
                    {code}
                  </code>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => copyCodes(freshCodes)}>
                  <Copy size={14} className="mr-1.5" />
                  Copiază
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => downloadCodes(freshCodes)}>
                  <Download size={14} className="mr-1.5" />
                  Descarcă .txt
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setFreshCodes(null)}
                  className="ml-auto"
                >
                  Am salvat, închide
                </Button>
              </div>
            </div>
          </div>
        </GlassCard>
      )}

      {/* ── REGENERATE BACKUP CODES (when 2FA already enabled) ─────── */}
      {totpEnabled && (
        <GlassCard className="p-6">
          <div className="flex items-start gap-3">
            <KeyRound size={18} className="mt-0.5 text-muted-foreground" />
            <div className="flex-1">
              <h2 className="font-medium">Coduri de rezervă</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {remaining?.remaining === undefined
                  ? 'Se verifică numărul codurilor rămase…'
                  : remaining.remaining === 0
                    ? 'Nu mai ai coduri de rezervă. Regenerează acum.'
                    : remaining.remaining <= 2
                      ? `Atenție: mai ai doar ${remaining.remaining} cod${remaining.remaining === 1 ? '' : 'uri'} de rezervă.`
                      : `Ai ${remaining.remaining} coduri de rezervă rămase.`}
              </p>
              <form
                className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
                onSubmit={(e) => {
                  e.preventDefault();
                  regenerateMut.mutate();
                }}
              >
                <div className="flex-1">
                  <label htmlFor="regen-pw" className="block text-xs font-medium text-muted-foreground">
                    Confirmă cu parola contului
                  </label>
                  <Input
                    id="regen-pw"
                    type="password"
                    placeholder="Parola ta"
                    value={regenPassword}
                    onChange={(e) => setRegenPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={regenerateMut.isPending || !regenPassword}>
                  {regenerateMut.isPending ? 'Se regenerează…' : 'Regenerează coduri'}
                </Button>
              </form>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Codurile vechi devin invalide imediat ce noile coduri sunt afișate.
              </p>
            </div>
          </div>
        </GlassCard>
      )}

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
