import * as React from 'react';
import { Link, useRouter } from '@tanstack/react-router';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { api } from '@/lib/api';
import { SearchBar } from '@/features/search/SearchBar';
import { Toaster } from '@/components/ui/Toaster';
import { useReminderPoller } from '@/hooks/useReminderPoller';
import { NotificationsBell } from './NotificationsBell';

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
  useReminderPoller();
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
          <NavLink to="/app/leads">Leads</NavLink>
          <NavLink to="/app/deals">Pipeline</NavLink>
          <NavLink to="/app/forecasting">Prognoze</NavLink>
          <NavLink to="/app/contracts">Contracte</NavLink>
          <NavLink to="/app/projects">Proiecte</NavLink>
          <NavLink to="/app/quotes">Oferte</NavLink>
          <NavLink to="/app/orders">Comenzi</NavLink>
          <NavLink to="/app/invoices">Facturi</NavLink>
          <NavLink to="/app/cases">Tichete suport</NavLink>
          <NavLink to="/app/campaigns">Campanii</NavLink>
          <NavLink to="/app/tasks">Task-uri</NavLink>
          <NavLink to="/app/reminders">Reminder-uri</NavLink>
          <NavLink to="/app/email-settings">Setări email</NavLink>
          <NavLink to="/app/email-sequences">Secvențe email</NavLink>
          <NavLink to="/app/contact-segments">Segmente</NavLink>
          <NavLink to="/app/products">Produse</NavLink>
          <NavLink to="/app/approvals">Aprobări</NavLink>
          <NavLink to="/app/calendar">Calendar</NavLink>
          <NavLink to="/app/workflows">Automatizări</NavLink>
          <NavLink to="/app/reports">Rapoarte</NavLink>
          {(user?.role === 'OWNER' || user?.role === 'ADMIN') && (
            <NavLink to="/app/phone-settings">Telefonie</NavLink>
          )}
          {(user?.role === 'OWNER' || user?.role === 'ADMIN') && (
            <NavLink to="/app/settings/users">Utilizatori</NavLink>
          )}
          {(user?.role === 'OWNER' || user?.role === 'ADMIN') && (
            <NavLink to="/app/settings/custom-fields">Câmpuri custom</NavLink>
          )}
          {(user?.role === 'OWNER' || user?.role === 'ADMIN') && (
            <NavLink to="/app/settings/webhooks">Webhook-uri</NavLink>
          )}
          {(user?.role === 'OWNER' || user?.role === 'ADMIN') && (
            <NavLink to="/app/settings/billing">Facturare</NavLink>
          )}
          {(user?.role === 'OWNER' || user?.role === 'ADMIN') && (
            <NavLink to="/app/audit">Jurnal audit</NavLink>
          )}
          <NavLink to="/app/settings/2fa">Securitate (2FA)</NavLink>
        </nav>
      </aside>
      <div className="flex flex-1 flex-col">
        <header className="flex h-14 items-center gap-4 border-b bg-background px-6">
          <div className="text-sm text-muted-foreground shrink-0">
            {user ? `${user.fullName} · ${user.email}` : '—'}
          </div>
          <SearchBar />
          <NotificationsBell />
          <Button variant="ghost" size="sm" onClick={handleLogout} className="shrink-0">
            Deconectare
          </Button>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
      <Toaster />
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
