import type { TourStep } from '../registry';

/**
 * Companies list page tour — 5 steps covering the core workflow:
 * find existing, add new, filter, bulk actions, sort.
 *
 * Selectors use data-tour="..." attributes for stability against CSS refactors.
 * Add the same data-tour attribute to the corresponding DOM element in
 * companies.list.page.tsx — the tour will not appear if any selector misses.
 */
export const companiesListTourSteps: TourStep[] = [
  {
    element: '[data-tour="companies-search"]',
    title: '1. Caută rapid o companie',
    description:
      'Tastează numele firmei, CUI-ul sau o industrie. Căutarea funcționează semantic — folosește embedding-uri AI ca să găsească chiar și fără potrivire perfectă.',
    side: 'bottom',
  },
  {
    element: '[data-tour="new-company-btn"]',
    title: '2. Adaugă o companie nouă',
    description:
      'Apasă aici sau Cmd+N (oriunde în aplicație). Câmpurile obligatorii: doar Numele. Restul (CUI, industrie, adresă) sunt opționale și se completează ulterior.',
    side: 'left',
  },
  {
    element: '[data-tour="companies-filters"]',
    title: '3. Filtrează după criterii',
    description:
      'Filtrează după status (LEAD / PROSPECT / ACTIVE / INACTIVE), sursă (referal, web, eveniment) sau mărime. Filtrele se combină cu AND.',
    side: 'bottom',
  },
  {
    element: '[data-tour="companies-table"]',
    title: '4. Click pe rând pentru detalii',
    description:
      'Pe fiecare companie ai pagina detaliată cu: contacte asociate, deal-uri active, note, atașamente, istoric apeluri. Click pe header de coloană pentru a sorta.',
    side: 'top',
  },
  {
    element: '[data-tour="companies-import-btn"]',
    title: '5. Import în masă din CSV',
    description:
      'Pentru import GestCom sau orice CSV cu firme: deschide meniul de operațional din dreapta sus. Fișierele până la 50 MB sunt procesate async — primești notificare când e gata.',
    side: 'bottom',
  },
];
