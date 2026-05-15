import type { TourStep } from '../registry';

/**
 * Email sequences tour — sequence, scheduled steps, exit rules.
 */
export const emailSequencesTourSteps: TourStep[] = [
  {
    element: '[data-tour="sequences-new-btn"]',
    title: '1. Secvență email',
    description: 'Drip campaigns automate pentru lead nurturing, onboarding sau urmărire ofertă.',
    side: 'left',
  },
  {
    element: '[data-tour="sequences-list"]',
    title: '2. Pași programați',
    description: 'Fiecare pas are subiect, conținut HTML și delay în zile față de înrolare.',
    side: 'top',
  },
  {
    element: '[data-tour="sequences-list"]',
    title: '3. Activează și înrolează',
    description: 'Statusul Activă deschide butonul „Înrolează contact". Pausează oricând pentru a opri trimiterile.',
    side: 'top',
  },
];
