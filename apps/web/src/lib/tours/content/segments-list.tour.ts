import type { TourStep } from '../registry';

/**
 * Contact segments tour — create, audience preview, export workflow.
 */
export const segmentsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="segments-new-btn"]',
    title: '1. Creează segment',
    description: 'Definește criterii (AND/OR) pe câmpuri de contact. Segmentul este re-evaluat dinamic la fiecare folosire.',
    side: 'left',
  },
  {
    element: '[data-tour="segments-list"]',
    title: '2. Preview audiență',
    description: 'Apasă „Preview" pe orice segment ca să vezi primele 20 de contacte care se potrivesc.',
    side: 'top',
  },
  {
    element: '[data-tour="segments-list"]',
    title: '3. Folosește în campanii',
    description: 'Segmentele alimentează campanii și secvențe email — definește-le o dată, refolosește peste tot.',
    side: 'top',
  },
];
