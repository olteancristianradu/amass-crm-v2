import type { TourStep } from '../registry';

/**
 * Company detail page tour — orientation on the 360° view of a company:
 * health, next action, tabs, and quick-actions sidebar.
 */
export const companyDetailTourSteps: TourStep[] = [
  {
    element: '[data-tour="company-header"]',
    title: '1. Pagina firmei',
    description: 'Aici ai vederea 360° a companiei: contacte, deal-uri, note, apeluri și fișiere.',
    side: 'bottom',
  },
  {
    element: '[data-tour="company-next-action"]',
    title: '2. Următoarea mișcare',
    description: 'Banner-ul îți spune ce e de făcut acum — apel, follow-up sau reminder restant.',
    side: 'bottom',
  },
  {
    element: '[data-tour="company-tabs"]',
    title: '3. Toate canalele într-un loc',
    description: 'Cronologie unificată sau filtrare pe canal: apeluri, note, deal-uri, email.',
    side: 'bottom',
  },
  {
    element: '[data-tour="company-health"]',
    title: '4. Sănătatea relației',
    description: 'Vezi imediat dacă relația e activă, răcită sau în derivă — fără să sapi în istoric.',
    side: 'left',
  },
];
