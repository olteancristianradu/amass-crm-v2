import type { TourStep } from '../registry';

/**
 * WhatsApp inbox (`/app/whatsapp`) tour — Meta WABA Business conversations.
 * Connect account, see threads per number, reply to client/contact/company.
 */
export const whatsappInboxTourSteps: TourStep[] = [
  {
    element: '[data-tour="whatsapp-connect-btn"]',
    title: '1. Conectează cont WhatsApp Business',
    description:
      'Adaugă un cont Meta WABA ca să primești și să trimiți mesaje direct din CRM.',
    side: 'left',
  },
  {
    element: '[data-tour="whatsapp-send-btn"]',
    title: '2. Trimite mesaj nou',
    description:
      'Atașează mesajul la un client, contact sau companie ca să se vadă în timeline-ul lor.',
    side: 'left',
  },
  {
    element: '[data-tour="whatsapp-accounts"]',
    title: '3. Conturi conectate',
    description:
      'Click pe „Vezi mesaje" la oricare cont ca să răsfoiești conversațiile inbound și outbound.',
    side: 'top',
  },
];
