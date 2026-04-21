import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';

// L-3: heavy route (~450 LOC + quotes feature module) — lazy-loaded so it
// doesn't inflate the initial app bundle.
const QuotesListPage = lazy(() =>
  import('./quotes.list.page').then((m) => ({ default: m.QuotesListPage })),
);

export const quotesListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/quotes',
  component: QuotesListPage,
});
