import type { TourStep } from '../registry';

/**
 * Tasks „Mine" (`/app/tasks`) tour — creare, finalizare, link la subject.
 */
export const tasksMineTourSteps: TourStep[] = [
  {
    element: '[data-tour="tasks-tabs"]',
    title: '1. Filtru Deschise / Finalizate',
    description:
      'Comută între task-urile active și cele bifate. Numărătoarea live se vede la tab-ul curent.',
    side: 'bottom',
  },
  {
    element: '[data-tour="new-task-btn"]',
    title: '2. Task nou rapid',
    description:
      'Doar titlul e obligatoriu. Prioritate, termen și descriere sunt opționale.',
    side: 'left',
  },
  {
    element: '[data-tour="tasks-list"]',
    title: '3. Lista taskurilor',
    description:
      'Click „Finalizează" pentru a închide un task. Cele cu subject (deal/companie) au link rapid.',
    side: 'top',
  },
];
