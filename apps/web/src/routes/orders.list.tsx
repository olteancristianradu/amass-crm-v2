import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const OrdersListPage = lazy(() =>
  import('./orders.list.page').then((m) => ({ default: m.OrdersListPage })),
);

export const ordersListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/orders',
  component: OrdersListPage,
});
