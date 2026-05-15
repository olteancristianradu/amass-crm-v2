import { KeyRound, Smartphone } from 'lucide-react';
import { GlassCard } from '@/components/ui/glass-card';
import { PageHeader } from '@/components/ui/page-header';
import { useTour } from '@/lib/tours/useTour';
import { DeviceList } from '@/features/passkeys/DeviceList';
import { RegisterPasskeyButton } from '@/features/passkeys/RegisterPasskeyButton';

/**
 * Settings → Securitate.
 *
 * Hosts the passkey registration UI (B2-PR3) and the device list +
 * revoke action (B2-PR4). The two cards share the same React Query key
 * (`passkeysQueryKey`) so a successful registration above auto-refreshes
 * the device list below — no manual wiring.
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

      <GlassCard className="p-6">
        <header className="mb-4 flex items-center gap-2">
          <Smartphone size={16} className="text-muted-foreground" />
          <h2 className="text-base font-semibold">Dispozitivele tale</h2>
        </header>
        {/*
          DeviceList renders its own wrapper carrying the
          data-tour="settings-security-devices" anchor, matching the
          placeholder slot it replaces.
        */}
        <DeviceList />
      </GlassCard>
    </div>
  );
}
