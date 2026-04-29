import type { TourStep } from '../registry';

export const contactsListTourSteps: TourStep[] = [
  {
    element: '[data-tour="contacts-search"]',
    title: '1. Caută persoane',
    description:
      'Tastează nume, email, telefon sau companie. Search-ul e semantic via embedding-uri AI — găsește chiar și „contabil firma X" fără să tastezi titlul exact.',
    side: 'bottom',
  },
  {
    element: '[data-tour="new-contact-btn"]',
    title: '2. Adaugă contact nou',
    description:
      'Câmpuri obligatorii: prenume + nume. Restul (companie, jobTitle, email, telefon, decision-maker) sunt opționale. Cmd+N funcționează ca shortcut global.',
    side: 'left',
  },
  {
    element: '[data-tour="contacts-table"]',
    title: '3. Click pe contact pentru detalii complete',
    description:
      'Pe pagina de detaliu vezi: companie asociată, deal-uri active, note polimorfice, atașamente, istoric apeluri și emailuri, consimțăminte GDPR per scop.',
    side: 'top',
  },
  {
    element: '[data-tour="contacts-export-btn"]',
    title: '4. Export CSV cu selecție',
    description:
      'Selectează câteva contacte cu checkbox-uri și apasă Export — primești doar selecția în CSV. Fără selecție → export complet (filtrat după query-ul curent).',
    side: 'bottom',
  },
];
