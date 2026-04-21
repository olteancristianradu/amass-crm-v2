import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: WhatsApp inbox — lazy-loaded.
const WhatsAppInboxPage = lazy(() =>
  import('./whatsapp.inbox.page').then((m) => ({ default: m.WhatsAppInboxPage })),
);

export const whatsappInboxRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/whatsapp',
  component: WhatsAppInboxPage,
});
