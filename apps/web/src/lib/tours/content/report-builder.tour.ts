import type { TourStep } from '../registry';

/**
 * Report builder (`/app/report-builder`) tour — custom report templates.
 * Pick entity + columns + limit, save as template, run on demand.
 */
export const reportBuilderTourSteps: TourStep[] = [
  {
    element: '[data-tour="report-builder-new-btn"]',
    title: '1. Template nou',
    description:
      'Construiește un raport custom ca să răspunzi rapid la întrebări recurente despre date.',
    side: 'left',
  },
  {
    element: '[data-tour="report-builder-templates"]',
    title: '2. Template-uri salvate',
    description:
      'Alege entitatea (companii, deal-uri, facturi…) și coloanele; salvează ca template reutilizabil.',
    side: 'top',
  },
  {
    element: '[data-tour="report-builder-actions"]',
    title: '3. Rulează sau șterge',
    description:
      'Template-urile salvate se rulează oricând cu un click — rezultatele apar mai jos.',
    side: 'left',
  },
];
