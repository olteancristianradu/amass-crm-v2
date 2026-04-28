import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const ContactDetailPage = lazy(() =>
  import('./contact.detail.page').then((m) => ({ default: m.ContactDetailPage })),
);

export const contactDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/contacts/$id',
  component: ContactDetailPage,
});
