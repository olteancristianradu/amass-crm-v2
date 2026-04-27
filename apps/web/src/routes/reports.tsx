import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// Lazy split — see reports.page.tsx for the actual implementation.
const ReportsPage = lazy(() =>
  import('./reports.page').then((m) => ({ default: m.ReportsPage })),
);

export const reportsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/reports',
  component: ReportsPage,
});
