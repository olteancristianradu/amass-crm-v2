import type { TourStep } from '../registry';

/**
 * NOTE: invoices.list.page.tsx currently has no search input or "Factură nouă"
 * button (factura se creează din pagina detaliului unei companii sau dintr-un
 * deal câștigat). Tour acoperă doar acțiunile disponibile pe pagina listă.
 * Când se adaugă search + create direct pe pagină, extinde tour-ul cu pașii
 * corespunzători aici.
 */
export const invoicesListTourSteps: TourStep[] = [
  {
    element: '[data-tour="invoices-table"]',
    title: '1. Lista facturilor + ANAF e-Factura',
    description:
      'Toate facturile emise apar aici. Coloana ANAF arată status-ul submisiei la SPV: PENDING (în curs), ACCEPTED (înregistrată) sau REJECTED (cu mesaj de eroare detaliat). XML-ul generat e UBL 2.1 (CIUS-RO).',
    side: 'top',
  },
  {
    element: '[data-tour="invoices-export-btn"]',
    title: '2. Export CSV pentru contabilitate',
    description:
      'Export CSV cu toate facturile vizibile (sau selecția marcată). Format compatibil cu Saga, SmartBill sau orice contabil care vrea import în soft-ul lui. CSV-ul are toate câmpurile fiscale (CUI, valoare, TVA, data emiterii, scadență).',
    side: 'bottom',
  },
  {
    element: '[data-tour="invoices-table"]',
    title: '3. Cum emit o factură nouă?',
    description:
      'În versiunea curentă, factura se creează din pagina detaliului unei companii (Companii → click pe companie → tab Facturi → „Emite factură") sau dintr-un deal câștigat (Deal-uri → deal câștigat → „Emite factură pe valoarea acestui deal"). Buton de creare directă din această listă vine în roadmap.',
    side: 'over',
  },
];
