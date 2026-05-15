import { companiesListTourSteps } from './content/companies-list.tour';
import { contactsListTourSteps } from './content/contacts-list.tour';
import { dealsKanbanTourSteps } from './content/deals-kanban.tour';
import { quotesListTourSteps } from './content/quotes-list.tour';
import { invoicesListTourSteps } from './content/invoices-list.tour';
import { dashboardTourSteps } from './content/dashboard.tour';
import { cockpitTourSteps } from './content/cockpit.tour';
import { tasksMineTourSteps } from './content/tasks-mine.tour';
import { calendarTourSteps } from './content/calendar.tour';
import { reportsTourSteps } from './content/reports.tour';
import { settingsUsersTourSteps } from './content/settings-users.tour';
import { importsTourSteps } from './content/imports.tour';
import { leadsListTourSteps } from './content/leads-list.tour';
import { segmentsListTourSteps } from './content/segments-list.tour';
import { projectsListTourSteps } from './content/projects-list.tour';
import { productsListTourSteps } from './content/products-list.tour';
import { contractsListTourSteps } from './content/contracts-list.tour';
import { ordersListTourSteps } from './content/orders-list.tour';
import { subscriptionsListTourSteps } from './content/subscriptions-list.tour';
import { commissionsListTourSteps } from './content/commissions-list.tour';
import { territoriesListTourSteps } from './content/territories-list.tour';
import { forecastingTourSteps } from './content/forecasting.tour';
import { casesListTourSteps } from './content/cases-list.tour';
import { approvalsListTourSteps } from './content/approvals-list.tour';
import { workflowsListTourSteps } from './content/workflows-list.tour';
import { campaignsListTourSteps } from './content/campaigns-list.tour';
import { emailSequencesTourSteps } from './content/email-sequences.tour';

export interface TourStep {
  element: string; // CSS selector — prefer data-tour="..." for stability
  title: string;
  description: string;
  side?: 'top' | 'bottom' | 'left' | 'right' | 'over';
}

export interface TourDef {
  id: string;
  title: string;
  description: string;
  page: string; // path where it auto-launches
  steps: TourStep[];
}

/**
 * Central registry of all product tours. Add new tours here to make them
 * discoverable from /app/help (re-launch buttons) and to allow analytics
 * to track adoption per tour.
 */
export const TOUR_REGISTRY: TourDef[] = [
  {
    id: 'companies-list',
    title: 'Lista companiilor',
    description: 'Cum cauți, adaugi și organizezi companiile clienților tăi.',
    page: '/app/companies',
    steps: companiesListTourSteps,
  },
  {
    id: 'contacts-list',
    title: 'Lista contactelor',
    description: 'Persoanele asociate la companii — search, decision-makers, export.',
    page: '/app/contacts',
    steps: contactsListTourSteps,
  },
  {
    id: 'deals-kanban',
    title: 'Pipeline kanban',
    description: 'Drag-and-drop deal-uri între etape, forecast pe coloană, multi-currency.',
    page: '/app/deals',
    steps: dealsKanbanTourSteps,
  },
  {
    id: 'quotes-list',
    title: 'Oferte',
    description: 'Generare oferte din deal-uri, trimitere la client prin portal, semnătură.',
    page: '/app/quotes',
    steps: quotesListTourSteps,
  },
  {
    id: 'invoices-list',
    title: 'Facturi + ANAF e-Factura',
    description: 'Emitere factură, trimitere automată la ANAF SPV, export pentru contabilitate.',
    page: '/app/invoices',
    steps: invoicesListTourSteps,
  },
  {
    id: 'dashboard',
    title: 'Dashboard',
    description: 'Bun venit + KPI-uri esențiale, brief AI și pipeline pe etape.',
    page: '/app',
    steps: dashboardTourSteps,
  },
  {
    id: 'cockpit',
    title: 'Pro Cockpit',
    description: 'Centrul de comandă: widget-uri configurabile cu drag-and-drop.',
    page: '/app/cockpit',
    steps: cockpitTourSteps,
  },
  {
    id: 'tasks-mine',
    title: 'Task-urile mele',
    description: 'Creare rapidă, finalizare, link la subject (deal/companie).',
    page: '/app/tasks',
    steps: tasksMineTourSteps,
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'Integrare Google/Outlook bidirecțională + creare evenimente.',
    page: '/app/calendar',
    steps: calendarTourSteps,
  },
  {
    id: 'reports',
    title: 'Rapoarte',
    description: 'Cele 4 perspective: Prezentare, Financiar, Forecast, Desfășurător apeluri.',
    page: '/app/reports',
    steps: reportsTourSteps,
  },
  {
    id: 'settings-users',
    title: 'Utilizatori și roluri',
    description: 'Invite user nou + rolurile RBAC: OWNER/ADMIN/MANAGER/AGENT/VIEWER.',
    page: '/app/settings/users',
    steps: settingsUsersTourSteps,
  },
  {
    id: 'imports',
    title: 'Import-uri',
    description: 'Istoric job-uri de import (CSV, GestCom PDF) cu status live.',
    page: '/app/imports',
    steps: importsTourSteps,
  },
  {
    id: 'leads-list',
    title: 'Lead-uri',
    description: 'Scoring 0-100, filtrare pe scor și sursă, conversie la client.',
    page: '/app/leads',
    steps: leadsListTourSteps,
  },
  {
    id: 'segments-list',
    title: 'Segmente contacte',
    description: 'Creare segment, preview audiență, refolosire în campanii.',
    page: '/app/contact-segments',
    steps: segmentsListTourSteps,
  },
  {
    id: 'projects-list',
    title: 'Proiecte',
    description: 'Proiecte după deal câștigat, link la client, status.',
    page: '/app/projects',
    steps: projectsListTourSteps,
  },
  {
    id: 'products-list',
    title: 'Produse',
    description: 'Catalog produse cu preț, TVA și bundle-uri.',
    page: '/app/products',
    steps: productsListTourSteps,
  },
  {
    id: 'contracts-list',
    title: 'Contracte',
    description: 'Termeni, expirare în 30 zile, status semnătură și auto-reînnoire.',
    page: '/app/contracts',
    steps: contractsListTourSteps,
  },
  {
    id: 'orders-list',
    title: 'Comenzi',
    description: 'Comandă, link la deal, generare factură.',
    page: '/app/orders',
    steps: ordersListTourSteps,
  },
  {
    id: 'subscriptions-list',
    title: 'Abonamente',
    description: 'Abonament recurent, perioadă facturare, MRR și ARR.',
    page: '/app/subscriptions',
    steps: subscriptionsListTourSteps,
  },
  {
    id: 'commissions-list',
    title: 'Comisioane',
    description: 'Planuri comision, calcul lunar, marcare plată.',
    page: '/app/commissions',
    steps: commissionsListTourSteps,
  },
  {
    id: 'territories-list',
    title: 'Teritorii',
    description: 'Teritoriu nou, atribuire agenți, performanță.',
    page: '/app/territories',
    steps: territoriesListTourSteps,
  },
  {
    id: 'forecasting',
    title: 'Prognoze vânzări',
    description: 'Setează cotă, alege perioadă, urmărește commit score.',
    page: '/app/forecasting',
    steps: forecastingTourSteps,
  },
  {
    id: 'cases-list',
    title: 'Tichete suport',
    description: 'Tichet nou, prioritate, SLA și escalare.',
    page: '/app/cases',
    steps: casesListTourSteps,
  },
  {
    id: 'approvals-list',
    title: 'Aprobări',
    description: 'Cereri de aprobare, politici, audit decizii.',
    page: '/app/approvals',
    steps: approvalsListTourSteps,
  },
  {
    id: 'workflows-list',
    title: 'Workflows',
    description: 'Automatizări pe trigger-e, pași și condiții.',
    page: '/app/workflows',
    steps: workflowsListTourSteps,
  },
  {
    id: 'campaigns-list',
    title: 'Campanii Marketing',
    description: 'Campanii multi-canal, audience, performanță live.',
    page: '/app/campaigns',
    steps: campaignsListTourSteps,
  },
  {
    id: 'email-sequences',
    title: 'Secvențe email',
    description: 'Drip campaigns automate cu pași programați și exit rules.',
    page: '/app/email-sequences',
    steps: emailSequencesTourSteps,
  },
];

export function getTourById(id: string): TourDef | undefined {
  return TOUR_REGISTRY.find((t) => t.id === id);
}
