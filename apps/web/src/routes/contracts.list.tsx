import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: contracts list — lazy-loaded.
const ContractsListPage = lazy(() =>
  import('./contracts.list.page').then((m) => ({ default: m.ContractsListPage })),
);

export const contractsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/contracts',
  component: ContractsListPage,
});
