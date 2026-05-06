import { useEffect } from 'react';

/**
 * Set `document.title` while the component is mounted, restore the
 * original title on unmount. Use it at the top of every route component:
 *
 *   usePageTitle('Pro Cockpit');
 *
 * Format: `<page> · AMASS CRM`. The trailing brand makes browser-tab
 * recognition easier when multiple AMASS tabs are open.
 */
export function usePageTitle(title: string | null | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} · AMASS CRM`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
