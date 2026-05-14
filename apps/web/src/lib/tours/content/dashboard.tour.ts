import type { TourStep } from '../registry';

/**
 * Dashboard (homepage `/app/`) tour — bun venit + KPI explainer.
 * Fires on first login după ce wizard-ul de welcome este finalizat.
 */
export const dashboardTourSteps: TourStep[] = [
  {
    element: '[data-tour="dashboard-brief"]',
    title: '1. Brief-ul tău AI',
    description:
      'Aici primești zilnic un rezumat generat AI: ce-i urgent, ce contează. Apasă pictograma refresh pentru a-l regenera.',
    side: 'bottom',
  },
  {
    element: '[data-tour="dashboard-kpis"]',
    title: '2. KPI-uri esențiale',
    description:
      'Cele 4 cifre principale pe ultimele 30 de zile: deals deschise/câștigate, apeluri și emailuri trimise.',
    side: 'bottom',
  },
  {
    element: '[data-tour="dashboard-pipeline"]',
    title: '3. Pipeline pe etape',
    description:
      'Distribuția deal-urilor active pe stage-uri. Click pe „Pipeline complet" pentru drag-and-drop kanban.',
    side: 'top',
  },
  {
    element: '[data-tour="dashboard-activity"]',
    title: '4. Activitate recentă',
    description:
      'Pulsul ultimelor 30 de zile: note, apeluri, emailuri, task-uri — sortate după volum.',
    side: 'left',
  },
];
