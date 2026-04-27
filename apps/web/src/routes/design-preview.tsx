import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// Lazy split — see design-preview.page.tsx for the actual implementation.
const DesignPreview = lazy(() =>
  import('./design-preview.page').then((m) => ({ default: m.DesignPreview })),
);

export const designPreviewRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/__design',
  component: DesignPreview,
});
