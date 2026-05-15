import type { TourStep } from '../registry';

/**
 * Cases list tour — create ticket, priority, SLA, escalation.
 */
export const casesListTourSteps: TourStep[] = [
  {
    element: '[data-tour="cases-new-btn"]',
    title: '1. Tichet nou',
    description: 'Adaugă manual tichete; cele primite prin email/portal apar automat aici.',
    side: 'left',
  },
  {
    element: '[data-tour="cases-table"]',
    title: '2. Prioritate',
    description: 'LOW / NORMAL / HIGH / URGENT. URGENT-urile sunt evidențiate vizual în KPI-uri.',
    side: 'top',
  },
  {
    element: '[data-tour="cases-kpis"]',
    title: '3. SLA deadline',
    description: 'Setează un termen-limită; tichetele care depășesc SLA-ul apar evidențiate cu roșu.',
    side: 'bottom',
  },
  {
    element: '[data-tour="cases-filters"]',
    title: '4. Filtrare și escalare',
    description: 'Filtrează după status sau prioritate ca să identifici rapid cazurile care necesită escalare.',
    side: 'bottom',
  },
];
