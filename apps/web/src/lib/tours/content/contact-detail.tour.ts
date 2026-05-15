import type { TourStep } from '../registry';

/**
 * Contact detail page tour — orientation on the person view:
 * who they are, next action, communication tabs, GDPR consents.
 */
export const contactDetailTourSteps: TourStep[] = [
  {
    element: '[data-tour="contact-header"]',
    title: '1. Profilul persoanei',
    description: 'Tot ce ai discutat cu acest contact — apeluri, email-uri, note, task-uri.',
    side: 'bottom',
  },
  {
    element: '[data-tour="contact-next-action"]',
    title: '2. Ce urmează cu el',
    description: 'Sugestia de pas următor — sună acum, trimite email sau setează un reminder.',
    side: 'bottom',
  },
  {
    element: '[data-tour="contact-tabs"]',
    title: '3. Istoric pe canale',
    description: 'Filtrează pe apeluri, email, note sau task-uri — sau vezi tot în cronologie.',
    side: 'bottom',
  },
  {
    element: '[data-tour="contact-gdpr"]',
    title: '4. Consimțăminte GDPR',
    description: 'Verifică rapid pe ce scopuri ai acord — marketing, profilare, comunicare.',
    side: 'left',
  },
];
