import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route (workflow builder) — lazy-loaded.
const WorkflowsPage = lazy(() =>
  import('./workflows.list.page').then((m) => ({ default: m.WorkflowsPage })),
);

export const workflowsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/workflows',
  component: WorkflowsPage,
});
