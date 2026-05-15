import type { TourStep } from '../registry';

/**
 * Events list (`/app/events`) tour — webinars, conferences, meetups.
 * Tracks attendees and capacity. Distinct from /app/calendar (Google/Outlook sync).
 */
export const eventsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="events-header"]',
    title: '1. Evenimente marketing',
    description:
      'Webinare, conferințe, workshop-uri și meetup-uri — ca să urmărești participanții.',
    side: 'bottom',
  },
  {
    element: '[data-tour="events-new-form"]',
    title: '2. Programează evenimentul',
    description:
      'Alege tipul, capacitatea, intervalul și locația. Participanții se atașează după creare.',
    side: 'bottom',
  },
  {
    element: '[data-tour="events-table"]',
    title: '3. Lista evenimentelor',
    description:
      'Vezi toate evenimentele programate și gestionează capacitatea în timp real.',
    side: 'top',
  },
];
