import type { TourStep } from '../registry';

/**
 * Settings → Webhooks (`/app/settings/webhooks`) tour —
 * endpoints HTTPS care primesc evenimente CRM cu semnătură HMAC.
 */
export const settingsWebhooksTourSteps: TourStep[] = [
  {
    element: '[data-tour="webhooks-new-btn"]',
    title: '1. Endpoint nou',
    description: 'URL HTTPS unde CRM-ul trimite evenimentele (deal.created, invoice.paid etc.) în propriul sistem.',
    side: 'left',
  },
  {
    element: '[data-tour="webhooks-list"]',
    title: '2. Endpoints active',
    description: 'Dezactivează temporar un webhook fără să-l ștergi — util la mentenanță pe sistemul extern.',
    side: 'top',
  },
  {
    element: '[data-tour="webhooks-signing-info"]',
    title: '3. Semnătură HMAC',
    description: 'Fiecare cerere are antetul X-Amass-Signature (SHA-256). Verifică-l ca să eviți request-uri false.',
    side: 'top',
  },
];
