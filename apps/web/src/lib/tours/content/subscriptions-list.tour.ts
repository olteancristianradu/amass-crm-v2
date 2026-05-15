import type { TourStep } from '../registry';

/**
 * Subscriptions list tour — recurring billing, period, MRR.
 */
export const subscriptionsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="subscriptions-new-btn"]',
    title: '1. Abonament recurent',
    description: 'Definește un abonament: client, plan (Basic/Pro), MRR și data de start.',
    side: 'left',
  },
  {
    element: '[data-tour="subscriptions-kpis"]',
    title: '2. Perioadă de facturare',
    description: 'Grupare pe plan disponibilă în secțiunea „Pe plan" — volumul lunar al fiecărui produs SaaS.',
    side: 'bottom',
  },
  {
    element: '[data-tour="subscriptions-kpis"]',
    title: '3. MRR, ARR și churn',
    description: 'MRR și ARR se calculează din toate abonamentele active. Churn arată anulările din ultimele 30 de zile.',
    side: 'bottom',
  },
];
