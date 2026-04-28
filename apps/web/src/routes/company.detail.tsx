import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const CompanyDetailPage = lazy(() =>
  import('./company.detail.page').then((m) => ({ default: m.CompanyDetailPage })),
);

export const companyDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/companies/$id',
  component: CompanyDetailPage,
});
