import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const ClientDetailPage = lazy(() =>
  import('./client.detail.page').then((m) => ({ default: m.ClientDetailPage })),
);

export const clientDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/clients/$id',
  component: ClientDetailPage,
});
