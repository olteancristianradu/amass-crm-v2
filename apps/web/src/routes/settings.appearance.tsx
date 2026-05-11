import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

const SettingsAppearancePage = lazy(() =>
  import('./settings.appearance.page').then((m) => ({
    default: m.SettingsAppearancePage,
  })),
);

export const settingsAppearanceRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/appearance',
  component: SettingsAppearancePage,
});
