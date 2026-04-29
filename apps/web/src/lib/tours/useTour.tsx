import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { driver, type Driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import { toursApi } from './api';
import { getTourById, type TourStep } from './registry';

interface UseTourOptions {
  /** When false, the tour does NOT auto-launch even if uncompleted. Default true. */
  autoLaunch?: boolean;
  /** Optional delay before auto-launching, to wait for content to render. ms. Default 600. */
  delayMs?: number;
}

/**
 * Auto-launch a product tour on a page if the current user hasn't completed
 * it yet. Marks completed when user finishes or skips. Persists in DB
 * (cross-device) via /tour-progress endpoints.
 *
 * Usage in a route component:
 *   useTour('companies-list');
 *
 * Make sure all selector elements (data-tour="...") are mounted by the time
 * the tour fires; the delayMs gives the queries + render a chance to settle.
 */
export function useTour(tourId: string, opts: UseTourOptions = {}): void {
  const { autoLaunch = true, delayMs = 600 } = opts;
  const driverRef = useRef<Driver | null>(null);
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['tour-progress'],
    queryFn: () => toursApi.listCompleted(),
    staleTime: 5 * 60 * 1000, // 5 min — tours don't change often
  });

  const completed = data?.completedTours ?? [];
  const isCompleted = completed.includes(tourId);
  const tour = getTourById(tourId);

  useEffect(() => {
    if (!autoLaunch || !tour || isCompleted) return;

    // Wait for content to render before checking selectors exist
    const handle = setTimeout(() => {
      // Skip if any element selector is missing — better silent skip than half tour
      for (const step of tour.steps) {
        if (!document.querySelector(step.element)) {
          // Selector missing — likely page still loading or layout differs
          return;
        }
      }

      const d = driver({
        showProgress: true,
        showButtons: ['next', 'previous', 'close'],
        steps: tour.steps.map(toDriverStep),
        nextBtnText: 'Înainte →',
        prevBtnText: '← Înapoi',
        doneBtnText: 'Gata',
        progressText: 'Pasul {{current}} din {{total}}',
        onDestroyed: () => {
          // Mark completed when user finishes or closes
          void toursApi.markCompleted(tourId).then(() => {
            void qc.invalidateQueries({ queryKey: ['tour-progress'] });
          });
        },
      });
      driverRef.current = d;
      d.drive();
    }, delayMs);

    return () => clearTimeout(handle);
  }, [tour, isCompleted, autoLaunch, delayMs, tourId, qc]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (driverRef.current) {
        driverRef.current.destroy();
      }
    };
  }, []);
}

/**
 * Manual trigger — used from /help page "Re-vezi tour-ul" button.
 * First marks tour as incomplete in DB so it stays available, then drives it.
 */
export async function launchTourManually(tourId: string): Promise<void> {
  const tour = getTourById(tourId);
  if (!tour) return;

  // Mark incomplete in DB so subsequent visits also auto-launch
  await toursApi.markIncomplete(tourId).catch(() => {
    // Non-fatal: tour still launches even if mark-incomplete fails
  });

  // Verify all selectors exist — bail silently if any missing.
  // The /help re-launch button is responsible for navigating to tour.page first.
  for (const step of tour.steps) {
    if (!document.querySelector(step.element)) {
      return;
    }
  }

  const d = driver({
    showProgress: true,
    steps: tour.steps.map(toDriverStep),
    nextBtnText: 'Înainte →',
    prevBtnText: '← Înapoi',
    doneBtnText: 'Gata',
    progressText: 'Pasul {{current}} din {{total}}',
    onDestroyed: () => {
      void toursApi.markCompleted(tourId);
    },
  });
  d.drive();
}

function toDriverStep(s: TourStep): {
  element: string;
  popover: { title: string; description: string; side?: 'top' | 'bottom' | 'left' | 'right' | 'over' };
} {
  return {
    element: s.element,
    popover: {
      title: s.title,
      description: s.description,
      ...(s.side ? { side: s.side } : {}),
    },
  };
}
