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
import { invoicesListRoute } from './routes/invoices.list';
import { quotesListRoute } from './routes/quotes.list';
import { emailSequencesRoute } from './routes/email-sequences.list';
import { contactSegmentsRoute } from './routes/contact-segments.list';
import { projectsListRoute } from './routes/projects.list';
import { projectDetailRoute } from './routes/project.detail';
import { settingsUsersRoute } from './routes/settings.users';
import { settings2faRoute } from './routes/settings.2fa';
import { auditRoute } from './routes/audit';
import { smsInboxRoute } from './routes/sms.inbox';
import { exportsRoute } from './routes/exports';
import { duplicatesRoute } from './routes/duplicates';
import { reportBuilderRoute } from './routes/report-builder';
import { whatsappInboxRoute } from './routes/whatsapp.inbox';
import { productsRoute } from './routes/products.list';
import { settingsCustomFieldsRoute } from './routes/settings.custom-fields';
import { approvalsRoute } from './routes/approvals.list';
import { calendarRoute } from './routes/calendar';
import { settingsBillingRoute } from './routes/settings.billing';
import { settingsWebhooksRoute } from './routes/settings.webhooks';
import { leadsListRoute } from './routes/leads.list';
import { contractsListRoute } from './routes/contracts.list';
import { forecastingRoute } from './routes/forecasting';
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
    invoicesListRoute,
    quotesListRoute,
    emailSequencesRoute,
    contactSegmentsRoute,
    projectsListRoute,
    projectDetailRoute,
    settingsUsersRoute,
    settings2faRoute,
    auditRoute,
    smsInboxRoute,
    exportsRoute,
    duplicatesRoute,
    reportBuilderRoute,
    whatsappInboxRoute,
    productsRoute,
    settingsCustomFieldsRoute,
    approvalsRoute,
    calendarRoute,
    settingsBillingRoute,
    settingsWebhooksRoute,
    leadsListRoute,
    contractsListRoute,
    forecastingRoute,
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
