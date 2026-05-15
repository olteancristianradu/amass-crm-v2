import type { TourStep } from '../registry';

/**
 * Settings → Appearance (`/app/settings/appearance`) tour —
 * themes, accent, density, radius, font, motion.
 */
export const settingsAppearanceTourSteps: TourStep[] = [
  {
    element: '[data-tour="appearance-themes"]',
    title: '1. Alege tema',
    description: 'Liquid Glass, High Contrast, Editorial sau brand-uri colorate. Schimbarea se aplică imediat.',
    side: 'bottom',
  },
  {
    element: '[data-tour="appearance-accent"]',
    title: '2. Culoarea de accent',
    description: 'Inelul de focus, butoanele primare și elementele active. Independentă de temă — îți pui amprenta.',
    side: 'bottom',
  },
  {
    element: '[data-tour="appearance-density"]',
    title: '3. Densitate',
    description: 'Compact pentru ecrane mici sau lucru intens; Aerisit pentru confort la scroll lung.',
    side: 'top',
  },
  {
    element: '[data-tour="appearance-font"]',
    title: '4. Font',
    description: 'Sistem, cu serife pentru lectură lungă, mono pentru date tabulare sau rotunjit pentru un look cald.',
    side: 'top',
  },
  {
    element: '[data-tour="appearance-motion"]',
    title: '5. Mișcare',
    description: 'Reduce sau oprește animațiile dacă te deranjează la scroll sau ai sensibilitate vestibulară.',
    side: 'top',
  },
];
