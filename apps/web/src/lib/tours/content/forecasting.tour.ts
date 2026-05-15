import type { TourStep } from '../registry';

/**
 * Forecasting tour — set quota, period, commit score.
 */
export const forecastingTourSteps: TourStep[] = [
  {
    element: '[data-tour="forecasting-quota-btn"]',
    title: '1. Setează target',
    description: 'Setează target lunar per agent (RON). Targetul devine baza pentru atingerea %.',
    side: 'left',
  },
  {
    element: '[data-tour="forecasting-period"]',
    title: '2. Perioadă',
    description: 'Schimbă anul și luna pentru a vedea forecast-ul pe perioada dorită.',
    side: 'bottom',
  },
  {
    element: '[data-tour="forecasting-kpis"]',
    title: '3. Pipeline vs Commit',
    description: 'Pipeline = suma ponderată cu probabilitate. Commit = doar deal-urile cu peste 70% șansă.',
    side: 'bottom',
  },
];
