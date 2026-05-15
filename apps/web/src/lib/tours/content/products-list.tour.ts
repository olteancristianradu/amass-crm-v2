import type { TourStep } from '../registry';

/**
 * Products list tour — create product, price + VAT, bundles.
 */
export const productsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="products-new-btn"]',
    title: '1. Produs nou',
    description: 'Adaugă produse pentru a le folosi în oferte și facturi cu prețuri și stocuri configurabile.',
    side: 'left',
  },
  {
    element: '[data-tour="products-table"]',
    title: '2. Preț + TVA',
    description: 'Preț unitar în RON, cota TVA (0/5/9/19%) — toate se aplică automat în oferte.',
    side: 'top',
  },
  {
    element: '[data-tour="products-table"]',
    title: '3. Categorii și bundles',
    description: 'Grupează produsele pe categorii. Bundles și SKU-uri se gestionează din detaliul produsului.',
    side: 'top',
  },
];
