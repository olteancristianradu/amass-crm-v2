import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// Lazy split — see forecasting.page.tsx for the actual implementation.
const ForecastingPage = lazy(() =>
  import('./forecasting.page').then((m) => ({ default: m.ForecastingPage })),
);

export const forecastingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/forecasting',
  component: ForecastingPage,
});
