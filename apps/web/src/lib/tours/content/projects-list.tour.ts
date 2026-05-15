import type { TourStep } from '../registry';

/**
 * Projects list tour — create, link company, status.
 */
export const projectsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="projects-new-btn"]',
    title: '1. Proiect nou',
    description: 'Proiecte apar automat la deal WON, sau le creezi manual aici.',
    side: 'left',
  },
  {
    element: '[data-tour="projects-list"]',
    title: '2. Link la client',
    description: 'Fiecare proiect e ancorat la o companie — click pe nume pentru detalii client.',
    side: 'top',
  },
  {
    element: '[data-tour="projects-list"]',
    title: '3. Status proiect',
    description: 'Stările PLANNED, ACTIVE, ON_HOLD, COMPLETED, CANCELLED conturează viața proiectului.',
    side: 'top',
  },
];
