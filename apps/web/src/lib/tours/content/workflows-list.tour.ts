import type { TourStep } from '../registry';

/**
 * Workflows list tour — automation, trigger, conditions.
 */
export const workflowsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="workflows-new-btn"]',
    title: '1. Automatizare',
    description: 'Workflows execută acțiuni automat: trimitere email, creare task, adăugare notă, așteptare.',
    side: 'left',
  },
  {
    element: '[data-tour="workflows-list"]',
    title: '2. Trigger-e disponibile',
    description: 'Deal creat/mutat în etapă, contact creat, companie creată — pe fiecare se atașează un workflow.',
    side: 'top',
  },
  {
    element: '[data-tour="workflows-list"]',
    title: '3. Condiții și pași',
    description: 'Adaugă pași secvențiali cu pauze între ei. Activează/dezactivează workflow-uri din butonul respectiv.',
    side: 'top',
  },
];
