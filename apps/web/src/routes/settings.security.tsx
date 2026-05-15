import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

const SettingsSecurityPage = lazy(() =>
  import('./settings.security.page').then((m) => ({
    default: m.SettingsSecurityPage,
  })),
);

export const settingsSecurityRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/security',
  component: SettingsSecurityPage,
});
