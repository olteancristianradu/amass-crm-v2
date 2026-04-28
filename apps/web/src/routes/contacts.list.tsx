import { lazy } from 'react';
import { createRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { authedRoute } from './authed';

// L-3: heavy route — lazy-loaded so it doesn't inflate the initial bundle.
const ContactsListPage = lazy(() =>
  import('./contacts.list.page').then((m) => ({ default: m.ContactsListPage })),
);

const searchSchema = z.object({
  q: z.string().optional(),
});

export const contactsRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/contacts',
  validateSearch: (search: Record<string, unknown>) => searchSchema.parse(search),
  component: ContactsListPage,
});
