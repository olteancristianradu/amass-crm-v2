import type { TourStep } from '../registry';

/**
 * Leads list page tour — scoring, filter, convert, status.
 * Selectors must match data-tour="..." attributes in leads.list.page.tsx.
 */
export const leadsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="leads-new-btn"]',
    title: '1. Lead nou',
    description: 'Adaugă rapid un lead — minim prenume și nume; restul completezi pe parcurs.',
    side: 'left',
  },
  {
    element: '[data-tour="leads-kpis"]',
    title: '2. Scor lead 0-100',
    description: 'Scorul agregă semnale (industrie, comportament, sursă). Sortează după scor pentru a prioritiza.',
    side: 'bottom',
  },
  {
    element: '[data-tour="leads-filters"]',
    title: '3. Filtre status și sursă',
    description: 'Filtrează după status (NEW, QUALIFIED…) sau sursă. Filtrele se combină.',
    side: 'bottom',
  },
  {
    element: '[data-tour="leads-table"]',
    title: '4. Convertește la client',
    description: 'Butonul Convertește din rând creează companie + contact + deal automat, păstrând istoricul.',
    side: 'top',
  },
];
