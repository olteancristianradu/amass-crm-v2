import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const ProductsListPage = lazy(() =>
  import('./products.list.page').then((m) => ({ default: m.ProductsListPage })),
);

export const productsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/products',
  component: ProductsListPage,
});
