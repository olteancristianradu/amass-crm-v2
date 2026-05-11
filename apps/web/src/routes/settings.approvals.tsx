import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// Code-split: settings pages are rarely the user's first hop. Keeping
// them out of the initial bundle cuts ~7-10KB gzip from index.js.
const SettingsApprovalsPage = lazy(() =>
  import('./settings.approvals.page').then((m) => ({ default: m.SettingsApprovalsPage })),
);

export const settingsApprovalsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/approvals',
  component: SettingsApprovalsPage,
});
