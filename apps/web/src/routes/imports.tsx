import { createRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authedRoute } from './authed';

const ImportsPage = lazy(() =>
  import('./imports.page').then((m) => ({ default: m.ImportsPage })),
);

export const importsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/imports',
  component: ImportsPage,
});
