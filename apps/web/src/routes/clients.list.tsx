import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const ClientsListPage = lazy(() =>
  import('./clients.list.page').then((m) => ({ default: m.ClientsListPage })),
);

const searchSchema = z.object({
  q: z.string().optional(),
});

export const clientsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/clients',
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  component: ClientsListPage,
});
