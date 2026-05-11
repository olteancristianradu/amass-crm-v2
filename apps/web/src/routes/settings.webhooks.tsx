import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

const SettingsWebhooksPage = lazy(() =>
  import('./settings.webhooks.page').then((m) => ({
    default: m.SettingsWebhooksPage,
  })),
);

export const settingsWebhooksRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/webhooks',
  component: SettingsWebhooksPage,
});
