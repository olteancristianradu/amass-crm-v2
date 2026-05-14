import type { TourStep } from '../registry';

/**
 * Calendar (`/app/calendar`) tour — integrări Google/Outlook + creare event.
 */
export const calendarTourSteps: TourStep[] = [
  {
    element: '[data-tour="calendar-new-event"]',
    title: '1. Eveniment nou',
    description:
      'Creezi un event direct în CRM care se sincronizează cu Google/Outlook conectat.',
    side: 'left',
  },
  {
    element: '[data-tour="calendar-integrations"]',
    title: '2. Conectează Google sau Outlook',
    description:
      'OAuth bidirecțional: evenimentele create aici apar în calendar și invers.',
    side: 'bottom',
  },
  {
    element: '[data-tour="calendar-range"]',
    title: '3. Filtru pe interval',
    description:
      'Selectează intervalul de zile pentru a vedea evenimentele relevante.',
    side: 'bottom',
  },
  {
    element: '[data-tour="calendar-events"]',
    title: '4. Lista evenimentelor',
    description:
      'Evenimentele agregate din toate calendarele conectate, în ordine cronologică.',
    side: 'top',
  },
];
