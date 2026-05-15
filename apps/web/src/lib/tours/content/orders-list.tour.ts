import type { TourStep } from '../registry';

/**
 * Orders list tour — create order, link to deal, invoice.
 */
export const ordersListTourSteps: TourStep[] = [
  {
    element: '[data-tour="orders-new-btn"]',
    title: '1. Comandă nouă',
    description: 'Comandă cu linii (descriere, cantitate, preț). Sursa poate fi o ofertă acceptată sau introducere directă.',
    side: 'left',
  },
  {
    element: '[data-tour="orders-kpis"]',
    title: '2. Link la deal și ofertă',
    description: 'Fiecare comandă păstrează urma către deal-ul și oferta din care a apărut.',
    side: 'bottom',
  },
  {
    element: '[data-tour="orders-table"]',
    title: '3. Status și factură',
    description: 'DRAFT → CONFIRMED → FULFILLED. La confirmare poți emite direct factura din meniul de acțiuni.',
    side: 'top',
  },
];
