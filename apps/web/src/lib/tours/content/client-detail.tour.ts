import type { TourStep } from '../registry';

/**
 * Client detail page tour — orientation on the B2C customer view:
 * relationship health, next action, communication tabs, GDPR panel.
 */
export const clientDetailTourSteps: TourStep[] = [
  {
    element: '[data-tour="client-header"]',
    title: '1. Fișa clientului',
    description: 'Toată relația cu acest client persoană fizică, într-un singur loc.',
    side: 'bottom',
  },
  {
    element: '[data-tour="client-next-action"]',
    title: '2. Următorul pas',
    description: 'Banner-ul îți spune ce e de făcut acum — apel, mesaj sau reminder activ.',
    side: 'bottom',
  },
  {
    element: '[data-tour="client-tabs"]',
    title: '3. Comunicare pe canale',
    description: 'Vezi tot în cronologie sau filtrează: apeluri, note, email-uri, task-uri.',
    side: 'bottom',
  },
  {
    element: '[data-tour="client-health"]',
    title: '4. Sănătatea relației',
    description: 'Indicator vizual: clientul e activ, răcit sau pierdut. Acționezi înainte să fie tardiv.',
    side: 'left',
  },
];
