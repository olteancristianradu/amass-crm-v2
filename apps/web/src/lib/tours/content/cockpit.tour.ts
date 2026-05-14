import type { TourStep } from '../registry';

/**
 * Pro Cockpit (`/app/cockpit`) tour — explică widget-urile și drag-and-drop.
 */
export const cockpitTourSteps: TourStep[] = [
  {
    element: '[data-tour="cockpit-header"]',
    title: '1. Pro Cockpit — comanda zilei',
    description:
      'Toate sarcinile prioritare într-un singur loc, ordonate după urgență. Se reîmprospătează automat la fiecare minut.',
    side: 'bottom',
  },
  {
    element: '[data-tour="cockpit-refresh"]',
    title: '2. Reîmprospătează feed-ul',
    description:
      'Forțează un refresh dacă vrei date live. Altfel, polling automat la 60 secunde.',
    side: 'bottom',
  },
  {
    element: '[data-tour="cockpit-picker"]',
    title: '3. Alege widget-urile',
    description:
      'Activează/dezactivează widget-uri: Top Deals, Reminders, Task-uri restante, Apeluri pierdute.',
    side: 'left',
  },
  {
    element: '[data-tour="cockpit-widgets"]',
    title: '4. Rearanjează prin drag-and-drop',
    description:
      'Trage un widget de bara de titlu pentru a-l muta. Poziția se salvează automat pentru contul tău.',
    side: 'top',
  },
];
