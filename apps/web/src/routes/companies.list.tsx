import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const CompaniesListPage = lazy(() =>
  import('./companies.list.page').then((m) => ({ default: m.CompaniesListPage })),
);

const searchSchema = z.object({
  q: z.string().optional(),
});

export const companiesRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/companies',
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  component: CompaniesListPage,
});
