import { createRoute } from '@tanstack/react-router';
import { authedRoute } from './authed';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';

export const dashboardRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/',
  component: Dashboard,
});

function Dashboard(): JSX.Element {
  const user = useAuthStore((s) => s.user);
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Bun venit</CardTitle>
          <CardDescription>{user?.fullName ?? '—'}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Rol: <span className="font-medium text-foreground">{user?.role}</span>
          <br />
          Tenant: <span className="font-mono text-xs">{user?.tenantId}</span>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Pasul următor</CardTitle>
          <CardDescription>S9 adaugă paginile de detaliu</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Folosește meniul din stânga pentru a naviga la Companii, Contacte și Clienți.
        </CardContent>
      </Card>
    </div>
  );
}
