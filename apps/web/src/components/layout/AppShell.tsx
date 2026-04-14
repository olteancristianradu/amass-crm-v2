import * as React from 'react';
import { Link, useRouter } from '@tanstack/react-router';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';
import { SearchBar } from '@/features/search/SearchBar';

interface Props {
  children: React.ReactNode;
}

/**
 * Authenticated shell: left sidebar + top bar + content area. Sidebar links
 * use TanStack Router's <Link activeProps={...}> for active-state styling so
 * there's no `useLocation()` gymnastics.
 */
export function AppShell({ children }: Props): JSX.Element {
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const router = useRouter();

  const handleLogout = async (): Promise<void> => {
    if (refreshToken) {
      try {
        await api.post('/auth/logout', { refreshToken });
      } catch {
        // Logout is fire-and-forget; even if the API call fails, wipe local state.
      }
    }
    clear();
    await router.navigate({ to: '/login' });
  };

  return (
    <div className="flex min-h-screen bg-muted/30">
      <aside className="hidden w-60 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center border-b px-6">
          <span className="font-semibold tracking-tight">AMASS-CRM</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3 text-sm">
          <NavLink to="/app">Dashboard</NavLink>
          <NavLink to="/app/companies">Companii</NavLink>
          <NavLink to="/app/contacts">Contacte</NavLink>
          <NavLink to="/app/clients">Clienți</NavLink>
          <NavLink to="/app/deals">Pipeline</NavLink>
          <NavLink to="/app/tasks">Task-uri</NavLink>
          <NavLink to="/app/reminders">Reminder-uri</NavLink>
          <NavLink to="/app/email-settings">Setări email</NavLink>
          <NavLink to="/app/workflows">Automatizări</NavLink>
          <NavLink to="/app/reports">Rapoarte</NavLink>
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-4 border-b bg-background px-6">
          <div className="text-sm text-muted-foreground shrink-0">
            {user ? `${user.fullName} · ${user.email}` : '—'}
          </div>
          <SearchBar />
          <Button variant="ghost" size="sm" onClick={handleLogout} className="shrink-0">
            Deconectare
          </Button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }): JSX.Element {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === '/app' }}
      className={cn(
        'rounded-md px-3 py-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
      )}
      activeProps={{ className: 'bg-secondary text-foreground font-medium' }}
    >
      {children}
    </Link>
  );
}
