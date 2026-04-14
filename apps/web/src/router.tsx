import { createRouter, createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './routes/root';
import { loginRoute } from './routes/login';
import { authedRoute } from './routes/authed';
import { dashboardRoute } from './routes/dashboard';
import { companiesRoute } from './routes/companies.list';
import { companyDetailRoute } from './routes/company.detail';
import { contactsRoute } from './routes/contacts.list';
import { contactDetailRoute } from './routes/contact.detail';
import { clientsRoute } from './routes/clients.list';
import { clientDetailRoute } from './routes/client.detail';
import { remindersMineRoute } from './routes/reminders.mine';
import { dealsKanbanRoute } from './routes/deals.kanban';
import { tasksMineRoute } from './routes/tasks.mine';
import { emailSettingsRoute } from './routes/email-settings';
import { searchRoute } from './routes/search';
import { workflowsRoute } from './routes/workflows.list';
import { reportsRoute } from './routes/reports';
import { phoneSettingsRoute } from './routes/phone-settings';
import { useAuthStore } from './stores/auth';

/**
 * Catch-all: "/" sends you to /app if logged in, else /login. This is a
 * pure redirect route with no component.
 */
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: useAuthStore.getState().isAuthenticated() ? '/app' : '/login' });
  },
  component: () => null,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  authedRoute.addChildren([
    dashboardRoute,
    companiesRoute,
    companyDetailRoute,
    contactsRoute,
    contactDetailRoute,
    clientsRoute,
    clientDetailRoute,
    dealsKanbanRoute,
    tasksMineRoute,
    remindersMineRoute,
    emailSettingsRoute,
    searchRoute,
    workflowsRoute,
    reportsRoute,
    phoneSettingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
