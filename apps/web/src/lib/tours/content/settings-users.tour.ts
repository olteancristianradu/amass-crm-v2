import type { TourStep } from '../registry';

/**
 * Settings → Users (`/app/settings/users`) tour — invite + roluri RBAC.
 */
export const settingsUsersTourSteps: TourStep[] = [
  {
    element: '[data-tour="users-invite-btn"]',
    title: '1. Invită un coleg',
    description:
      'Adaugă utilizatori noi în tenantul tău. Primesc email cu parola temporară de schimbat la primul login.',
    side: 'left',
  },
  {
    element: '[data-tour="users-active-list"]',
    title: '2. Utilizatori activi',
    description:
      'Toți cei care pot accesa CRM-ul. Click pe rolul lor pentru a-l schimba (dacă ești OWNER/ADMIN).',
    side: 'top',
  },
  {
    element: '[data-tour="users-roles-info"]',
    title: '3. Rolurile RBAC',
    description:
      'OWNER (toate drepturile) · ADMIN (config) · MANAGER (echipă) · AGENT (lucru zilnic) · VIEWER (read-only).',
    side: 'top',
  },
];
