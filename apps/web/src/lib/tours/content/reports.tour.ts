import type { TourStep } from '../registry';

/**
 * Reports (`/app/reports`) tour — cele 4 taburi + selector perioadă.
 */
export const reportsTourSteps: TourStep[] = [
  {
    element: '[data-tour="reports-period"]',
    title: '1. Selectează perioada',
    description:
      'Default: ultimele 30 zile. Poți alege 7/90/365 zile sau interval personalizat.',
    side: 'bottom',
  },
  {
    element: '[data-tour="reports-tabs"]',
    title: '2. Patru perspective',
    description:
      'Prezentare generală, Financiar (facturi), Forecast pipeline, Desfășurător apeluri pe zi.',
    side: 'bottom',
  },
  {
    element: '[data-tour="reports-content"]',
    title: '3. Conținutul raportului',
    description:
      'Stat-uri, tabele și grafice — totul filtrat pe perioada și tabul ales.',
    side: 'top',
  },
];
