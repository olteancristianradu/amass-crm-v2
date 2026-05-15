import type { TourStep } from '../registry';

/**
 * Settings → Approvals config (`/app/settings/approvals`) tour —
 * politici de aprobare automate pentru oferte și discount-uri.
 */
export const settingsApprovalsConfigTourSteps: TourStep[] = [
  {
    element: '[data-tour="approvals-config-header"]',
    title: '1. La ce folosesc',
    description: 'Două declanșatoare: ofertă peste o sumă sau discount peste un procent. Manager-ul aprobă în /approvals.',
    side: 'bottom',
  },
  {
    element: '[data-tour="approvals-config-new-btn"]',
    title: '2. Politică nouă',
    description: 'Creezi reguli care opresc agenții să trimită oferte fără semnătura unui manager.',
    side: 'left',
  },
  {
    element: '[data-tour="approvals-config-list"]',
    title: '3. Politici existente',
    description: 'Dezactivează temporar o regulă fără s-o ștergi — util la promoții sau campanii speciale.',
    side: 'top',
  },
];
