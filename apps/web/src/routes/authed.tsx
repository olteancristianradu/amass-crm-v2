import { Suspense } from 'react';
import { createRoute, Outlet, redirect } from '@tanstack/react-router';
import { rootRoute } from './root';
import { AppShell } from '@/components/layout/AppShell';
import { useAuthStore } from '@/stores/auth';

/**
 * "/app" — the authenticated pathless-prefix-equivalent. Any protected page
 * gets added as a child of this route and inherits the auth guard + shell.
 *
 * Guard logic: we check the store directly, not via React hooks, because
 * beforeLoad runs OUTSIDE the React tree.
 */
export const authedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/app',
  beforeLoad: ({ location }) => {
    if (!useAuthStore.getState().isAuthenticated()) {
      throw redirect({
        to: '/login',
        search: { redirect: location.href },
      });
    }
  },
  component: AuthedLayout,
});

// L-3: Suspense boundary so heavy route components (loaded via React.lazy)
// don't crash the tree while their chunk is fetching.
function AuthedLayout(): JSX.Element {
  return (
    <AppShell>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Se încarcă…</p>}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}
