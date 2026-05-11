import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

const SettingsBillingPage = lazy(() =>
  import('./settings.billing.page').then((m) => ({
    default: m.SettingsBillingPage,
  })),
);

export const settingsBillingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/billing',
  component: SettingsBillingPage,
});
