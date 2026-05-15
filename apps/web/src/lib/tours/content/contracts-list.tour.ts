import type { TourStep } from '../registry';

/**
 * Contracts list tour — create, terms, signature status.
 */
export const contractsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="contracts-new-btn"]',
    title: '1. Contract nou',
    description: 'Atașează contractul la o companie; valoare, monedă, start și expirare se setează la creare.',
    side: 'left',
  },
  {
    element: '[data-tour="contracts-kpis"]',
    title: '2. Termeni și expirare',
    description: 'Contractele care expiră în 30 de zile sunt evidențiate — programează renegocierea din timp.',
    side: 'bottom',
  },
  {
    element: '[data-tour="contracts-table"]',
    title: '3. Status și auto-reînnoire',
    description: 'DRAFT → ACTIVE → EXPIRED/TERMINATED/RENEWED. Coloana auto-reînnoire arată ce continuă singur.',
    side: 'top',
  },
];
