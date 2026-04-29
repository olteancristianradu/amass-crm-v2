import { createRootRoute, Outlet } from '@tanstack/react-router';
import { CookieConsentBanner } from '@/components/legal/CookieConsent';

/**
 * Root layout — every route renders inside this <Outlet />. Intentionally
 * bare: the authenticated layout handles its own shell, and the public
 * (login) route renders full-screen.
 *
 * Cookie consent banner sits at root so it appears on EVERY page (public +
 * authenticated). It self-dismisses after the user picks Accept/Reject and
 * persists the choice in localStorage.
 */
export const rootRoute = createRootRoute({
  component: () => (
    <>
      <Outlet />
      <CookieConsentBanner />
    </>
  ),
});
