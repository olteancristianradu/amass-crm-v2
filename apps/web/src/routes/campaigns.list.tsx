import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

const CampaignsListPage = lazy(() =>
  import('./campaigns.list.page').then((m) => ({
    default: m.CampaignsListPage,
  })),
);

export const campaignsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/campaigns',
  component: CampaignsListPage,
});
