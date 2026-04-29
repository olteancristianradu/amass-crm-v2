import type { TourStep } from '../registry';

export const dealsKanbanTourSteps: TourStep[] = [
  {
    element: '[data-tour="new-deal-btn"]',
    title: '1. Adaugă deal nou',
    description:
      'Click aici sau Cmd+N. Trebuie să asociezi obligatoriu: pipeline + etapă + companie sau contact. Valoarea și data estimată de închidere sunt opționale dar utile pentru forecast.',
    side: 'left',
  },
  {
    element: '[data-tour="deals-stage-column"]',
    title: '2. Etape Kanban',
    description:
      'Coloanele reprezintă etapele pipeline-ului default („Nou", „Calificat", „Negociere", „Câștigat", „Pierdut"). Drag-and-drop între ele actualizează etapa instant. Ordinea în coloană e persistată.',
    side: 'right',
  },
  {
    element: '[data-tour="deal-card"]',
    title: '3. Card de deal',
    description:
      'Fiecare card arată titlu, valoare (multi-currency), companie, owner, data estimată de închidere. Click → pagina de detaliu cu istoric complet (note, activități, oferte, facturi).',
    side: 'top',
  },
  {
    element: '[data-tour="deals-stage-total"]',
    title: '4. Forecast pe etapă',
    description:
      'Header-ul fiecărei coloane arată suma valorilor × probabilitatea etapei. „Câștigat" = 100% (revenue confirmed), „Negociere" = 60%, etc. Valoare totală = forecast pipeline real.',
    side: 'bottom',
  },
];
