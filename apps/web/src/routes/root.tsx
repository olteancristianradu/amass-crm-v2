import { createRootRoute, Outlet } from '@tanstack/react-router';

/**
 * Root layout — every route renders inside this <Outlet />. Intentionally
 * bare: the authenticated layout handles its own shell, and the public
 * (login) route renders full-screen.
 */
export const rootRoute = createRootRoute({
  component: () => <Outlet />,
});
