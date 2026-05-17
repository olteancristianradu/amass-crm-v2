/**
 * Phase 0 / Migration A — i18n wiring.
 *
 * Init order (read top-down):
 *   1. Register namespaces by static import for the default locale (RO) so
 *      first paint is synchronous — no Suspense flash on the very first
 *      render. EN is loaded lazily on demand via `changeLanguageWithLoad`
 *      so the EN catalog ships in its OWN chunk (~25-30 KB gzip) and does
 *      not bloat the main bundle for the 95% of users who never switch.
 *   2. LanguageDetector reads in order: cookie → localStorage → navigator.
 *      Cookie is the source of truth set by the BE-side resolver (future);
 *      for now it falls through to localStorage which the language switcher
 *      writes on change.
 *   3. `supportedLngs: ['ro','en']` is the whitelist that defeats
 *      T-I18N-S-02 (RTL/bidi override) — i18next refuses to load a locale
 *      not in this list, even if the URL/cookie claims otherwise. The same
 *      whitelist lives in `packages/shared/src/locale.ts` and is enforced
 *      again at the BE.
 *   4. `escapeValue: false` is intentional — React JSX already escapes
 *      interpolated values. We ALSO ban `dangerouslySetInnerHTML` on
 *      translated strings via a CI grep (see scripts/i18n-no-dangerous-html.ts).
 *      Net effect: no XSS surface from translations (T-I18N-T-02).
 *   5. When a key is missing in the active locale, i18next falls back to RO
 *      (fallbackLng); if the key is missing in BOTH it returns the KEY ITSELF
 *      (e.g. "deals:list.title") so QA spots the gap immediately instead of
 *      seeing an empty UI (T-I18N-I-01 — no raw-key fallback to user-visible
 *      string until a translation lands).
 */

import i18next from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LOCALE, LOCALE_VALUES, LocaleSchema, type Locale } from '@amass/shared';

// ── Eager imports for RO (default locale) — bundled into the main chunk ──
import roCommon from './ro/common.json';
import roErrors from './ro/errors.json';
import roAuth from './ro/auth.json';
import roCompanies from './ro/companies.json';
import roContacts from './ro/contacts.json';
import roClients from './ro/clients.json';
import roLeads from './ro/leads.json';
import roDeals from './ro/deals.json';
import roInvoices from './ro/invoices.json';
import roQuotes from './ro/quotes.json';
import roContracts from './ro/contracts.json';
import roProjects from './ro/projects.json';
import roTasks from './ro/tasks.json';
import roCalendar from './ro/calendar.json';
import roCalls from './ro/calls.json';
import roEmail from './ro/email.json';
import roCockpit from './ro/cockpit.json';
import roCustomFields from './ro/customFields.json';
import roNotes from './ro/notes.json';
import roReminders from './ro/reminders.json';
import roAttachments from './ro/attachments.json';
import roNotifications from './ro/notifications.json';
import roSearch from './ro/search.json';
import roSync from './ro/sync.json';
import roOffline from './ro/offline.json';
import roTags from './ro/tags.json';
import roEvents from './ro/events.json';
import roPipelines from './ro/pipelines.json';
import roProducts from './ro/products.json';
import roOrders from './ro/orders.json';
import roCases from './ro/cases.json';
import roCampaigns from './ro/campaigns.json';
import roCustomerSubscriptions from './ro/customerSubscriptions.json';
import roContactSegments from './ro/contactSegments.json';
import roEmailSequences from './ro/emailSequences.json';
import roDuplicates from './ro/duplicates.json';
import roSavedViews from './ro/savedViews.json';
import roExports from './ro/exports.json';
import roWhatsapp from './ro/whatsapp.json';
import roSms from './ro/sms.json';
import roOutlook from './ro/outlook.json';
import roWebhooks from './ro/webhooks.json';
import roPasskeys from './ro/passkeys.json';
import roBilling from './ro/billing.json';
import roGdpr from './ro/gdpr.json';
import roCommissions from './ro/commissions.json';
import roTerritories from './ro/territories.json';
import roApprovals from './ro/approvals.json';
import roForecasting from './ro/forecasting.json';
import roReportBuilder from './ro/reportBuilder.json';
import roAnaf from './ro/anaf.json';
import roEntityDetail from './ro/entityDetail.json';

const RO_RESOURCES = {
  common: roCommon,
  errors: roErrors,
  auth: roAuth,
  companies: roCompanies,
  contacts: roContacts,
  clients: roClients,
  leads: roLeads,
  deals: roDeals,
  invoices: roInvoices,
  quotes: roQuotes,
  contracts: roContracts,
  projects: roProjects,
  tasks: roTasks,
  calendar: roCalendar,
  calls: roCalls,
  email: roEmail,
  cockpit: roCockpit,
  customFields: roCustomFields,
  notes: roNotes,
  reminders: roReminders,
  attachments: roAttachments,
  notifications: roNotifications,
  search: roSearch,
  sync: roSync,
  offline: roOffline,
  tags: roTags,
  events: roEvents,
  pipelines: roPipelines,
  products: roProducts,
  orders: roOrders,
  cases: roCases,
  campaigns: roCampaigns,
  customerSubscriptions: roCustomerSubscriptions,
  contactSegments: roContactSegments,
  emailSequences: roEmailSequences,
  duplicates: roDuplicates,
  savedViews: roSavedViews,
  exports: roExports,
  whatsapp: roWhatsapp,
  sms: roSms,
  outlook: roOutlook,
  webhooks: roWebhooks,
  passkeys: roPasskeys,
  billing: roBilling,
  gdpr: roGdpr,
  commissions: roCommissions,
  territories: roTerritories,
  approvals: roApprovals,
  forecasting: roForecasting,
  reportBuilder: roReportBuilder,
  anaf: roAnaf,
  entityDetail: roEntityDetail,
} as const;

export const NAMESPACES = Object.keys(RO_RESOURCES) as Array<keyof typeof RO_RESOURCES>;

/**
 * Lazy-load EN catalog. Triggered by `changeLanguageWithLoad('en')` or by
 * i18next itself the first time a translation is requested for 'en'.
 *
 * Every import target is statically known so Vite/Rollup can group the
 * EN JSON modules into a single chunk (`en-locale-*.js`). We DELIBERATELY
 * do not use `import.meta.glob` — that would pull both locales into the
 * main bundle's dep graph unconditionally.
 */
async function loadEnResources(): Promise<Record<string, unknown>> {
  const modules = await Promise.all([
    import('./en/common.json'),
    import('./en/errors.json'),
    import('./en/auth.json'),
    import('./en/companies.json'),
    import('./en/contacts.json'),
    import('./en/clients.json'),
    import('./en/leads.json'),
    import('./en/deals.json'),
    import('./en/invoices.json'),
    import('./en/quotes.json'),
    import('./en/contracts.json'),
    import('./en/projects.json'),
    import('./en/tasks.json'),
    import('./en/calendar.json'),
    import('./en/calls.json'),
    import('./en/email.json'),
    import('./en/cockpit.json'),
    import('./en/customFields.json'),
    import('./en/notes.json'),
    import('./en/reminders.json'),
    import('./en/attachments.json'),
    import('./en/notifications.json'),
    import('./en/search.json'),
    import('./en/sync.json'),
    import('./en/offline.json'),
    import('./en/tags.json'),
    import('./en/events.json'),
    import('./en/pipelines.json'),
    import('./en/products.json'),
    import('./en/orders.json'),
    import('./en/cases.json'),
    import('./en/campaigns.json'),
    import('./en/customerSubscriptions.json'),
    import('./en/contactSegments.json'),
    import('./en/emailSequences.json'),
    import('./en/duplicates.json'),
    import('./en/savedViews.json'),
    import('./en/exports.json'),
    import('./en/whatsapp.json'),
    import('./en/sms.json'),
    import('./en/outlook.json'),
    import('./en/webhooks.json'),
    import('./en/passkeys.json'),
    import('./en/billing.json'),
    import('./en/gdpr.json'),
    import('./en/commissions.json'),
    import('./en/territories.json'),
    import('./en/approvals.json'),
    import('./en/forecasting.json'),
    import('./en/reportBuilder.json'),
    import('./en/anaf.json'),
    import('./en/entityDetail.json'),
  ]);
  // The list of namespace names matches the order of imports above.
  const out: Record<string, unknown> = {};
  for (let i = 0; i < NAMESPACES.length; i++) {
    const mod = modules[i] as { default: unknown };
    out[NAMESPACES[i]!] = mod.default;
  }
  return out;
}

let enLoadPromise: Promise<void> | null = null;

/**
 * Public helper: switch the active language, lazy-loading the EN catalog
 * the first time it's needed. RO is always pre-loaded so this is a no-op
 * for the default case.
 *
 * Validated against the shared `LocaleSchema` — silently returns the
 * default locale on garbage input (T-I18N-S-02). Caller is responsible for
 * surfacing UX when an unsupported value comes from the BE.
 */
export async function changeLanguageWithLoad(locale: string): Promise<Locale> {
  const parsed = LocaleSchema.safeParse(locale);
  if (!parsed.success) return DEFAULT_LOCALE;
  const target = parsed.data;
  if (target === 'en' && !i18next.hasResourceBundle('en', 'common')) {
    if (!enLoadPromise) {
      enLoadPromise = loadEnResources().then((bundles) => {
        for (const [ns, data] of Object.entries(bundles)) {
          i18next.addResourceBundle('en', ns, data, true, true);
        }
      });
    }
    await enLoadPromise;
  }
  await i18next.changeLanguage(target);
  return target;
}

/**
 * Init i18next exactly once. Returns the same instance on every call so
 * HMR / tests can re-import this module without re-initialising (which
 * would warn and double-trigger detection).
 */
let initialised = false;
export function initI18n(): typeof i18next {
  if (initialised) return i18next;
  initialised = true;

  void i18next
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources: { ro: RO_RESOURCES },
      // T-I18N-S-02 whitelist — anything outside this list is rejected.
      supportedLngs: [...LOCALE_VALUES],
      fallbackLng: DEFAULT_LOCALE,
      defaultNS: 'common',
      ns: NAMESPACES,
      // React JSX already escapes interpolated children; double-escape
      // produces literal `&amp;` in the UI.
      interpolation: { escapeValue: false },
      // We use `:` for namespace separation and `.` for keypath.
      nsSeparator: ':',
      keySeparator: '.',
      returnNull: false,
      detection: {
        order: ['cookie', 'localStorage', 'navigator'],
        // Cookie name aligns with what the BE-side resolver will write.
        // localStorage key kept verbose to avoid colliding with auth/ui keys.
        lookupCookie: 'amass_locale',
        lookupLocalStorage: 'amass:locale',
        caches: ['cookie', 'localStorage'],
        // Cookie is a non-sensitive UI preference; lax SameSite is fine.
        cookieOptions: { path: '/', sameSite: 'lax' },
      },
      react: {
        // With Suspense ON, the very first render before init resolves
        // throws — fine in real app code, painful in component tests where
        // the QueryClientProvider mounts trans-children synchronously.
        useSuspense: false,
      },
      // Silent saveMissing in prod so a single missing translation doesn't
      // spam Sentry; warn in dev so QA spots gaps.
      saveMissing: false,
      missingKeyHandler: (lngs, ns, key) => {
        if (import.meta.env.DEV) {
          console.warn(`[i18n.missing] ns=${ns} key=${key} lng=${lngs.join(',')}`);
        }
      },
    });

  // WCAG 3.1.1 / 3.1.2 — keep <html lang> in sync with the active locale.
  // SR/AT switch pronunciation engine + per-element fallbacks rely on this.
  // We update on every change AND set the initial value below, because
  // i18next's detector may resolve a locale *after* the DOM has loaded.
  if (typeof document !== 'undefined') {
    const normalise = (lng: string): string => lng.split('-')[0] ?? DEFAULT_LOCALE;
    i18next.on('languageChanged', (lng) => {
      document.documentElement.lang = normalise(lng);
    });
    // Initial set — language may already be resolved if detection ran sync.
    if (i18next.language) {
      document.documentElement.lang = normalise(i18next.language);
    }
  }

  // If the language detector picked 'en', pre-load EN now so the very first
  // render does not flash RO before EN swaps in. Best-effort, fire-and-forget.
  if (i18next.language?.startsWith('en')) {
    void changeLanguageWithLoad('en');
  }

  return i18next;
}

// Export the singleton + a typed `t` for non-component code paths
// (toasts, errors, validation pipes).
export { i18next };
export const t = i18next.t.bind(i18next);
