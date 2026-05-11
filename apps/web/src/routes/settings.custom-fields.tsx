import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

const SettingsCustomFieldsPage = lazy(() =>
  import('./settings.custom-fields.page').then((m) => ({
    default: m.SettingsCustomFieldsPage,
  })),
);

export const settingsCustomFieldsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/custom-fields',
  component: SettingsCustomFieldsPage,
});
