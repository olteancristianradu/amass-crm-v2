import type { TourStep } from '../registry';

/**
 * Commissions tour — plans, monthly compute, payout.
 */
export const commissionsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="commissions-plans"]',
    title: '1. Planuri de comision',
    description: 'Definește planuri cu procent fix (ex: 5% din valoarea deal-ului câștigat).',
    side: 'top',
  },
  {
    element: '[data-tour="commissions-compute"]',
    title: '2. Calcul lunar',
    description: 'Alege anul, luna și planul, apoi „Calculează" — comisioanele se generează din deal-urile WON.',
    side: 'top',
  },
  {
    element: '[data-tour="commissions-results"]',
    title: '3. Marcare plătit',
    description: 'După plată, marchează comisionul „plătit" pentru a-l scoate din pendings și a închide raportul lunar.',
    side: 'top',
  },
];
