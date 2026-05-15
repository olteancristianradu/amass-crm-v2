import type { TourStep } from '../registry';

/**
 * Settings → Call script (`/app/settings/call-script`) tour —
 * checklist de puncte pe care AI le evaluează la fiecare apel înregistrat.
 */
export const settingsCallScriptTourSteps: TourStep[] = [
  {
    element: '[data-tour="call-script-add"]',
    title: '1. Adaugă punct',
    description: 'Pașii pe care orice agent trebuie să-i atingă: salut, nevoie, buget, ofertă, follow-up.',
    side: 'bottom',
  },
  {
    element: '[data-tour="call-script-list"]',
    title: '2. Ordine + reorganizare',
    description: 'Mută punctele cu săgețile. Ordinea contează — AI verifică acoperirea după fluxul real al apelului.',
    side: 'top',
  },
  {
    element: '[data-tour="call-script-save"]',
    title: '3. Salvează scriptul',
    description: 'După salvare, fiecare apel transcris primește un scor + lista punctelor ratate pe pagina apelului.',
    side: 'left',
  },
];
