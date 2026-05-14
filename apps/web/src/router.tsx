import { useEffect } from 'react';
import { createRouter, createRoute, redirect } from '@tanstack/react-router';
import { rootRoute } from './routes/root';
import { loginRoute } from './routes/login';
import { registerRoute } from './routes/register';
import { forgotPasswordRoute } from './routes/forgot-password';
import { privacyRoute } from './routes/privacy';
import { subprocessorsRoute } from './routes/subprocessors';
import { pricingRoute } from './routes/pricing';
import { resetPasswordRoute } from './routes/reset-password';
import { authedRoute } from './routes/authed';
import { dashboardRoute } from './routes/dashboard';
import { cockpitRoute } from './routes/cockpit';
import { welcomeRoute } from './routes/welcome';
import { helpRoute } from './routes/help';
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
import { settingsAppearanceRoute } from './routes/settings.appearance';
import { auditRoute } from './routes/audit';
import { smsInboxRoute } from './routes/sms.inbox';
import { exportsRoute } from './routes/exports';
import { duplicatesRoute } from './routes/duplicates';
import { importsRoute } from './routes/imports';
import { reportBuilderRoute } from './routes/report-builder';
import { whatsappInboxRoute } from './routes/whatsapp.inbox';
import { productsRoute } from './routes/products.list';
import { settingsCustomFieldsRoute } from './routes/settings.custom-fields';
import { settingsCallScriptRoute } from './routes/settings.call-script';
import { approvalsRoute } from './routes/approvals.list';
import { calendarRoute } from './routes/calendar';
import { settingsBillingRoute } from './routes/settings.billing';
import { settingsWebhooksRoute } from './routes/settings.webhooks';
import { settingsApprovalsRoute } from './routes/settings.approvals';
import { leadsListRoute } from './routes/leads.list';
import { contractsListRoute } from './routes/contracts.list';
import { forecastingRoute } from './routes/forecasting';
import { casesListRoute } from './routes/cases.list';
import { ordersListRoute } from './routes/orders.list';
import { campaignsListRoute } from './routes/campaigns.list';
import { subscriptionsListRoute } from './routes/subscriptions.list';
import { commissionsListRoute } from './routes/commissions.list';
import { territoriesListRoute } from './routes/territories.list';
import { eventsListRoute } from './routes/events.list';
import { notificationsRoute } from './routes/notifications';
import { designPreviewRoute } from './routes/design-preview';
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
  registerRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  privacyRoute,
  subprocessorsRoute,
  pricingRoute,
  authedRoute.addChildren([
    dashboardRoute,
    cockpitRoute,
    welcomeRoute,
    helpRoute,
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
    settingsAppearanceRoute,
    auditRoute,
    smsInboxRoute,
    exportsRoute,
    duplicatesRoute,
    importsRoute,
    reportBuilderRoute,
    whatsappInboxRoute,
    productsRoute,
    settingsCustomFieldsRoute,
    settingsCallScriptRoute,
    approvalsRoute,
    calendarRoute,
    settingsBillingRoute,
    settingsWebhooksRoute,
    settingsApprovalsRoute,
    leadsListRoute,
    contractsListRoute,
    forecastingRoute,
    casesListRoute,
    ordersListRoute,
    campaignsListRoute,
    subscriptionsListRoute,
    commissionsListRoute,
    territoriesListRoute,
    eventsListRoute,
    notificationsRoute,
    designPreviewRoute,
  ]),
]);

/**
 * Detect the "stale lazy chunk after deploy" failure mode the router shows
 * as `Something went wrong! Failed to fetch dynamically imported module …`.
 * Browser is sitting on a cached index.html that references hashed chunks
 * the new web container no longer serves. Auto-reload picks up the fresh
 * index.html. sessionStorage guard prevents an infinite refresh loop on
 * a genuine network outage.
 */
function isStaleChunkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    /Loading chunk \d+ failed/.test(msg)
  );
}

function DeployRefreshError({ error }: { error: unknown }): JSX.Element {
  const stale = isStaleChunkError(error);
  // Auto-reload runs as a side-effect — calling sessionStorage during render
  // is flagged as impure by the React compiler lint plugin. useEffect runs
  // after commit, which is the correct place for "kick off a reload".
  useEffect(() => {
    if (!stale || typeof window === 'undefined') return;
    const flag = 'amass:stale-chunk-reload-at';
    const last = Number(sessionStorage.getItem(flag) ?? '0');
    if (Date.now() - last > 30_000) {
      sessionStorage.setItem(flag, String(Date.now()));
      window.location.reload();
    }
  }, [stale]);
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error');
  return (
    <div className="min-h-[40vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-card border border-border/70 rounded-lg shadow-md p-6">
        <h1 className="text-lg font-semibold mb-2">
          {stale ? 'Aplicația a fost actualizată' : 'Ceva nu a mers bine'}
        </h1>
        <p className="text-sm text-muted-foreground mb-4">
          {stale
            ? 'A apărut o versiune nouă a CRM-ului. Reîncarcă pagina pentru a continua.'
            : message}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="w-full bg-primary text-primary-foreground rounded px-4 py-2 text-sm font-medium hover:bg-primary/90"
        >
          Reîncarcă pagina
        </button>
      </div>
    </div>
  );
}

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultErrorComponent: DeployRefreshError,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
