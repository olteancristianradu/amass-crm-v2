import type { TourStep } from '../registry';

/**
 * Audit log (`/app/audit`) tour — security & sensitive change log.
 * Visible only to OWNER/ADMIN. Useful for GDPR / forensic review.
 */
export const auditLogTourSteps: TourStep[] = [
  {
    element: '[data-tour="audit-header"]',
    title: '1. Jurnal audit',
    description:
      'Toate acțiunile sensibile (login, creare, ștergere, export) sunt logate aici append-only.',
    side: 'bottom',
  },
  {
    element: '[data-tour="audit-table"]',
    title: '2. Filtrare după acțiune, actor, subiect',
    description:
      'Coloanele arată cine, ce și de unde — folosește pentru investigații GDPR sau incident.',
    side: 'top',
  },
];
