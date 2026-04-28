import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const CalendarPage = lazy(() =>
  import('./calendar.page').then((m) => ({ default: m.CalendarPage })),
);

export const calendarRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/calendar',
  component: CalendarPage,
});
