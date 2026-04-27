import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// Lazy split — see report-builder.page.tsx for the actual implementation.
const ReportBuilderPage = lazy(() =>
  import('./report-builder.page').then((m) => ({ default: m.ReportBuilderPage })),
);

export const reportBuilderRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/report-builder',
  component: ReportBuilderPage,
});
