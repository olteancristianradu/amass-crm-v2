import type { TourStep } from '../registry';

/**
 * Territories tour — create, assign agent, performance.
 */
export const territoriesListTourSteps: TourStep[] = [
  {
    element: '[data-tour="territories-new"]',
    title: '1. Teritoriu nou',
    description: 'Definește teritoriul prin județe și/sau industrii — folosit la atribuirea automată a lead-urilor.',
    side: 'bottom',
  },
  {
    element: '[data-tour="territories-list"]',
    title: '2. Atribuire agent',
    description: 'Adaugă mai mulți agenți unui teritoriu prin user ID. Lead-urile noi sunt distribuite round-robin.',
    side: 'top',
  },
  {
    element: '[data-tour="territories-list"]',
    title: '3. Performanță',
    description: 'Vezi în rapoarte care teritorii și agenți conving mai mult — ajustează reguli sau redistribuie.',
    side: 'top',
  },
];
