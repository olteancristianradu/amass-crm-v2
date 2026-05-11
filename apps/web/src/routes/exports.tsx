import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

const ExportsPage = lazy(() =>
  import('./exports.page').then((m) => ({ default: m.ExportsPage })),
);

export const exportsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/exports',
  component: ExportsPage,
});
