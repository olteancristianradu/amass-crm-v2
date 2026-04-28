import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const DealsKanbanPage = lazy(() =>
  import('./deals.kanban.page').then((m) => ({ default: m.DealsKanbanPage })),
);

export const dealsKanbanRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/deals',
  component: DealsKanbanPage,
});
