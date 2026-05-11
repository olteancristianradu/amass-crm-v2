import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

const DuplicatesPage = lazy(() =>
  import('./duplicates.page').then((m) => ({ default: m.DuplicatesPage })),
);

export const duplicatesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/duplicates',
  component: DuplicatesPage,
});
