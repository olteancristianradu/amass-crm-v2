import { companiesListTourSteps } from './content/companies-list.tour';
import { contactsListTourSteps } from './content/contacts-list.tour';
import { dealsKanbanTourSteps } from './content/deals-kanban.tour';
import { quotesListTourSteps } from './content/quotes-list.tour';
import { invoicesListTourSteps } from './content/invoices-list.tour';

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
];

export function getTourById(id: string): TourDef | undefined {
  return TOUR_REGISTRY.find((t) => t.id === id);
}
