import type { TourStep } from '../registry';

/**
 * Campaigns list tour — create campaign, audience, performance.
 */
export const campaignsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="campaigns-new-btn"]',
    title: '1. Campanie nouă',
    description: 'Definește campanii multi-canal: Email, SMS, WhatsApp sau combinate.',
    side: 'left',
  },
  {
    element: '[data-tour="campaigns-table"]',
    title: '2. Audience și target',
    description: 'Numărul de contacte vizate alimentează rata de trimitere și conversiile finale.',
    side: 'top',
  },
  {
    element: '[data-tour="campaigns-kpis"]',
    title: '3. Performanță live',
    description: 'KPI-urile arată trimiterile, conversiile și venitul atribuit campaniei — în timp real.',
    side: 'bottom',
  },
];
