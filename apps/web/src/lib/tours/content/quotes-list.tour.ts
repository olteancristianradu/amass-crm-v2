import type { TourStep } from '../registry';

export const quotesListTourSteps: TourStep[] = [
  {
    element: '[data-tour="quotes-search"]',
    title: '1. Caută oferta',
    description:
      'Search după număr de ofertă, companie destinatară sau status (DRAFT / SENT / ACCEPTED / REJECTED / EXPIRED).',
    side: 'bottom',
  },
  {
    element: '[data-tour="new-quote-btn"]',
    title: '2. Creează ofertă nouă',
    description:
      'Generezi de la zero sau pleci de la un deal existent (pre-completează companie, contact, valoare). Numerele de ofertă sunt auto-incremental per tenant și anul curent.',
    side: 'left',
  },
  {
    element: '[data-tour="quotes-table"]',
    title: '3. Status oferte',
    description:
      'Status-ul DRAFT = nesendată, SENT = trimisă către client (cu link portal), ACCEPTED/REJECTED = decizia clientului din portal sau marcată manual. EXPIRED = peste data de validitate.',
    side: 'top',
  },
];
