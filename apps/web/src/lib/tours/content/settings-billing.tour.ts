import type { TourStep } from '../registry';

/**
 * Settings → Billing (`/app/settings/billing`) tour —
 * abonament Stripe, trial, gestionare metode de plată.
 */
export const settingsBillingTourSteps: TourStep[] = [
  {
    element: '[data-tour="billing-summary"]',
    title: '1. Plan și status',
    description: 'Vezi planul activ, statusul (trial/activ/restant) și până când e plătită perioada curentă.',
    side: 'bottom',
  },
  {
    element: '[data-tour="billing-actions"]',
    title: '2. Upgrade sau gestionare',
    description: 'Upgrade trece via Stripe Checkout. „Gestionează" deschide portalul cu facturi și carduri.',
    side: 'top',
  },
];
