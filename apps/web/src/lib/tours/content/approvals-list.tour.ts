import type { TourStep } from '../registry';

/**
 * Approvals list tour — request approval, policies, audit.
 */
export const approvalsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="approvals-filters"]',
    title: '1. Cereri în așteptare',
    description: 'Implicit vezi cererile PENDING. Comută la APPROVED / REJECTED pentru istoric.',
    side: 'bottom',
  },
  {
    element: '[data-tour="approvals-table"]',
    title: '2. Politici de aprobare',
    description: 'Cererile apar automat pentru oferte peste pragul setat în politici (Setări → Aprobări).',
    side: 'top',
  },
  {
    element: '[data-tour="approvals-table"]',
    title: '3. Audit decizii',
    description: 'Fiecare aprobare/respingere e logată cu comentariu — istoricul rămâne pentru audit GDPR.',
    side: 'top',
  },
];
