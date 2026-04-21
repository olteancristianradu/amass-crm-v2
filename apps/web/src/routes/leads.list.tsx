import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded to keep initial bundle small.
const LeadsListPage = lazy(() =>
  import('./leads.list.page').then((m) => ({ default: m.LeadsListPage })),
);

export const leadsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/leads',
  component: LeadsListPage,
});
