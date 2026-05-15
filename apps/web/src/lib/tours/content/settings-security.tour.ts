import type { TourStep } from '../registry';

/**
 * Settings → Securitate (`/app/settings/security`) tour.
 *
 * Short, 3 steps: explain what a passkey is, point at the register button,
 * point at the (currently placeholder) device list. Romanian copy ≤100
 * chars per description, in line with the rest of the tours.
 */
export const settingsSecurityTourSteps: TourStep[] = [
  {
    element: '[data-tour="settings-security-passkeys"]',
    title: '1. Ce e un passkey?',
    description:
      'O cheie criptografică legată de dispozitiv — te conectezi cu Face ID, Touch ID sau YubiKey, fără parolă.',
    side: 'bottom',
  },
  {
    element: '[data-tour="settings-security-passkeys"]',
    title: '2. Înregistrează-l',
    description:
      'Apasă butonul, confirmă pe dispozitiv. Poți denumi passkey-ul ca să-l recunoști mai târziu.',
    side: 'bottom',
  },
  {
    element: '[data-tour="settings-security-devices"]',
    title: '3. Dispozitivele tale',
    description:
      'Aici vei vedea toate passkey-urile înregistrate. Le poți revoca oricând. (În curând.)',
    side: 'top',
  },
];
