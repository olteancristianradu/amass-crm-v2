import type { TourStep } from '../registry';

/**
 * Clients list (`/app/clients`) tour — B2C persons.
 * Differentiates from companies-list: clients = individual buyers, not companies.
 */
export const clientsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="clients-search"]',
    title: '1. Caută un client B2C',
    description:
      'Tastează nume, email sau oraș ca să găsești rapid persoana individuală cu care lucrezi.',
    side: 'bottom',
  },
  {
    element: '[data-tour="clients-new-btn"]',
    title: '2. Client nou',
    description:
      'Adaugă o persoană fizică — diferit de companii. Obligatoriu doar prenume și nume.',
    side: 'left',
  },
  {
    element: '[data-tour="clients-table"]',
    title: '3. Editare inline + detalii',
    description:
      'Click pe nume pentru fișa completă, sau editează direct email/telefon/oraș din tabel.',
    side: 'top',
  },
];
