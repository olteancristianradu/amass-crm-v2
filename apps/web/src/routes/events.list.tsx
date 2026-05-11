import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

const EventsPage = lazy(() =>
  import('./events.list.page').then((m) => ({ default: m.EventsPage })),
);

export const eventsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/events',
  component: EventsPage,
});
