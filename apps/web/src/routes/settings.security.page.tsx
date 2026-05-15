import { KeyRound, Smartphone } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PageHeader } from '@/components/ui/page-header';
import { useTour } from '@/lib/tours/useTour';
import { RegisterPasskeyButton } from '@/features/passkeys/RegisterPasskeyButton';

/**
 * Settings → Securitate.
 *
 * Today this page hosts the passkey registration UI (B2-PR3). The device
 * list + revoke action lands in B2-PR4 — the slot is reserved here so the
 * page layout is stable across PRs and the future component just swaps
 * into the placeholder.
 *
 * Why a separate page (instead of /settings/2fa): we already have a
 * `/settings/2fa` page for TOTP. Mixing TOTP and passkey config on the
 * same page was rejected in design review because the audiences differ —
 * passkeys are the "I want to skip passwords" power-user, TOTP is the
 * "I added a second factor on top of my password" cautious user. Separate
 * pages = clearer mental model + room to grow each independently.
 */
export function SettingsSecurityPage(): JSX.Element {
  useTour('settings-security');

  return (
    <div>
      <PageHeader
        title="Securitate"
        subtitle="Passkeys + autentificare cu Face ID / Touch ID / YubiKey"
      />

      <GlassCard className="mb-6 p-6" data-tour="settings-security-passkeys">
        <header className="mb-4 flex items-center gap-2">
          <KeyRound size={16} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Passkeys</h2>
        </header>
        <p className="mb-4 text-sm text-muted-foreground">
          Înregistrează un passkey ca să te conectezi fără parolă. Pe Mac /
          iPhone folosește Face ID sau Touch ID, pe Windows folosește Windows
          Hello, iar pe alte dispozitive poți folosi o cheie hardware (YubiKey).
        </p>
        <RegisterPasskeyButton />
      </GlassCard>

      <GlassCard className="p-6" data-tour="settings-security-devices">
        <header className="mb-4 flex items-center gap-2">
          <Smartphone size={16} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Dispozitivele tale</h2>
        </header>
        {/*
          Placeholder until B2-PR4 ships the real device list + revoke.
          The data-tour anchor and section header are already in place so
          the tour script + Settings nav don't need to change when the
          component swaps in.
        */}
        <div className="rounded-md border border-dashed border-border/70 bg-secondary/30 p-6 text-center">
          <p className="text-sm font-medium">
            Lista cu device-urile tale va apărea aici
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Odată ce înregistrezi un passkey, îl vei vedea aici cu data
            ultimei utilizări și un buton de revocare. (În curând, B2-PR4.)
          </p>
        </div>
      </GlassCard>
    </div>
  );
}
