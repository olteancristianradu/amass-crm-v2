import { createRoute } from '@tanstack/react-router';
import { lazy } from 'react';
import { authedRoute } from './authed';

const SettingsCallScriptPage = lazy(() =>
  import('./settings.call-script.page').then((m) => ({ default: m.SettingsCallScriptPage })),
);

export const settingsCallScriptRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/call-script',
  component: SettingsCallScriptPage,
});
