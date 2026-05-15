import type { TourStep } from '../registry';

/**
 * Settings → Custom fields (`/app/settings/custom-fields`) tour —
 * câmpuri proprii pe orice entitate (company/contact/deal/...).
 */
export const settingsCustomFieldsTourSteps: TourStep[] = [
  {
    element: '[data-tour="custom-fields-entity-tabs"]',
    title: '1. Alege entitatea',
    description: 'Câmpurile sunt per entitate — un câmp pe Companie nu apare pe Deal. Fiecare tab are propria listă.',
    side: 'bottom',
  },
  {
    element: '[data-tour="custom-fields-new-btn"]',
    title: '2. Câmp nou',
    description: 'Text, Număr, Dată, Da/Nu sau Listă valori. Util pentru NPS, industrie internă, segment client.',
    side: 'left',
  },
  {
    element: '[data-tour="custom-fields-table"]',
    title: '3. Activează / dezactivează',
    description: 'Câmpurile inactive nu apar în formularele entității, dar datele existente rămân în baza de date.',
    side: 'top',
  },
];
