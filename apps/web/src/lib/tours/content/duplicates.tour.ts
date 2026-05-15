import type { TourStep } from '../registry';

/**
 * Duplicates page tour — find dupes for a company and merge them.
 * Three steps: pick source, run search, choose survivor + victims, merge.
 */
export const duplicatesTourSteps: TourStep[] = [
  {
    element: '[data-tour="duplicates-source"]',
    title: '1. Alege compania sursă',
    description: 'Selectează o firmă din listă — vom căuta înregistrări similare cu ea.',
    side: 'bottom',
  },
  {
    element: '[data-tour="duplicates-find-btn"]',
    title: '2. Caută duplicate',
    description: 'Algoritmul fuzzy compară nume, CUI și oraș — primești o listă cu scor de similaritate.',
    side: 'left',
  },
  {
    element: '[data-tour="duplicates-table"]',
    title: '3. Supravietuitor vs victime',
    description: 'Bifează una ca supravietuitoare (datele rămân) și restul ca victime (se șterg după fuzionare).',
    side: 'top',
  },
];
