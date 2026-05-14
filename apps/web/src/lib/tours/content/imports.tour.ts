import type { TourStep } from '../registry';

/**
 * Imports (`/app/imports`) tour — istoric job-uri + status live.
 */
export const importsTourSteps: TourStep[] = [
  {
    element: '[data-tour="imports-header"]',
    title: '1. Istoric import-uri',
    description:
      'Fiecare fișier urcat (CSV, PDF GestCom etc.) apare aici cu statistici complete.',
    side: 'bottom',
  },
  {
    element: '[data-tour="imports-table"]',
    title: '2. Status live pe fiecare job',
    description:
      'Job-urile active se reîmprospătează la 3 secunde. Vezi total rânduri, reușite, sărite, eșuate.',
    side: 'top',
  },
];
