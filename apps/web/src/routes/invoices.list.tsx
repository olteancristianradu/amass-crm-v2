import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const InvoicesListPage = lazy(() =>
  import('./invoices.list.page').then((m) => ({ default: m.InvoicesListPage })),
);

export const invoicesListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/invoices',
  component: InvoicesListPage,
});
