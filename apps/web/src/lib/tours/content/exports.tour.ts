import type { TourStep } from '../registry';

/**
 * Exports (`/app/exports`) tour — GDPR-safe data export jobs.
 * Async pipeline: request → PENDING → PROCESSING → DONE (download link, valid 15 min).
 */
export const exportsTourSteps: TourStep[] = [
  {
    element: '[data-tour="exports-new-btn"]',
    title: '1. Export nou',
    description:
      'Solicită un export ca să descarci datele tale în CSV pentru contabilitate sau migrare.',
    side: 'left',
  },
  {
    element: '[data-tour="exports-table"]',
    title: '2. Status live al job-urilor',
    description:
      'PENDING → PROCESSING → DONE. Tabelul se reîmprospătează la 5 secunde cât job-ul rulează.',
    side: 'top',
  },
  {
    element: '[data-tour="exports-download-col"]',
    title: '3. Descarcă fișierul',
    description:
      'Când job-ul e DONE, primești buton de descărcare cu URL semnat valid 15 minute.',
    side: 'top',
  },
];
