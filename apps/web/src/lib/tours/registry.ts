import { companiesListTourSteps } from './content/companies-list.tour';

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
    title: 'Lista de companii',
    description: 'Cum cauți, adaugi și organizezi companiile clientilor tăi.',
    page: '/app/companies',
    steps: companiesListTourSteps,
  },
];

export function getTourById(id: string): TourDef | undefined {
  return TOUR_REGISTRY.find((t) => t.id === id);
}
