import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, UserMinus, UserPlus } from 'lucide-react';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  ListSurface,
  PageHeader,
  StatusBadge,
  type StatusBadgeTone,
} from '@/components/ui/page-header';

export const settingsUsersRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/users',
  component: SettingsUsersPage,
});

type UserRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'AGENT' | 'VIEWER';

interface TenantUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  isActive: boolean;
  createdAt: string;
}

const ROLE_LABELS: Record<UserRole, string> = {
  OWNER: 'Proprietar',
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  AGENT: 'Agent',
  VIEWER: 'Vizualizator',
};

const ROLE_TONES: Record<UserRole, StatusBadgeTone> = {
  OWNER: 'pink',
  ADMIN: 'blue',
  MANAGER: 'green',
  AGENT: 'neutral',
  VIEWER: 'neutral',
};

const ROLE_ORDER: UserRole[] = ['OWNER', 'ADMIN', 'MANAGER', 'AGENT', 'VIEWER'];

const usersApi = {
  list: () => api.get<TenantUser[]>('/users'),
  invite: (body: { email: string; fullName: string; role: UserRole; password: string }) =>
    api.post<TenantUser>('/users', body),
  updateRole: (id: string, role: UserRole) =>
    api.patch<TenantUser>(`/users/${id}/role`, { role }),
  deactivate: (id: string) => api.delete<TenantUser>(`/users/${id}`),
  activate: (id: string) => api.post<TenantUser>(`/users/${id}/activate`),
};

function SettingsUsersPage(): JSX.Element {
  const qc = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const isOwnerOrAdmin = currentUser?.role === 'OWNER' || currentUser?.role === 'ADMIN';
  const [showInvite, setShowInvite] = useState(false);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.list(),
  });

  const deactivateMut = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const activateMut = useMutation({
    mutationFn: (id: string) => usersApi.activate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });
  const roleMut = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => usersApi.updateRole(id, role),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const activeUsers = users.filter((u) => u.isActive);
  const inactiveUsers = users.filter((u) => !u.isActive);

  return (
    <div>
      <PageHeader
        title="Gestiune utilizatori"
        subtitle="Toate persoanele din tenantul tău cu roluri și acces."
        actions={
          isOwnerOrAdmin && (
            <Button size="sm" onClick={() => setShowInvite((v) => !v)}>
              <Plus size={14} className="mr-1.5" />
              {showInvite ? 'Anulează' : 'Invită utilizator'}
            </Button>
          )
        }
      />

      {showInvite && isOwnerOrAdmin && (
        <InviteForm
          onSuccess={() => {
            setShowInvite(false);
            qc.invalidateQueries({ queryKey: ['users'] });
          }}
          onCancel={() => setShowInvite(false)}
        />
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}

      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        Utilizatori activi <span className="tabular-nums">({activeUsers.length})</span>
      </h2>
      <ListSurface>
        {activeUsers.length === 0 && !isLoading ? (
          <EmptyState
            icon={UserPlus}
            title="Niciun utilizator activ"
            description="Invită primul utilizator pentru a colabora pe acest tenant."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">Nume</th>
                  <th scope="col" className="px-4 py-3 font-medium">Email</th>
                  <th scope="col" className="px-4 py-3 font-medium">Rol</th>
                  <th scope="col" className="px-4 py-3 font-medium">Adăugat</th>
                  {isOwnerOrAdmin && (
                    <th scope="col" className="px-4 py-3 text-right font-medium">Acțiuni</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {activeUsers.map((user) => (
                  <tr
                    key={user.id}
                    className="border-b border-border/40 last:border-0 transition-colors hover:bg-secondary/40"
                  >
                    <td className="px-4 py-3 font-medium">{user.fullName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-3">
                      {isOwnerOrAdmin && user.id !== currentUser?.id ? (
                        <select
                          value={user.role}
                          onChange={(e) =>
                            roleMut.mutate({ id: user.id, role: e.target.value as UserRole })
                          }
                          disabled={roleMut.isPending}
                          className="rounded-md border border-input bg-background px-2 py-0.5 text-xs"
                        >
                          {ROLE_ORDER.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusBadge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</StatusBadge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs tabular-nums text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString('ro-RO')}
                    </td>
                    {isOwnerOrAdmin && (
                      <td className="px-4 py-3 text-right">
                        {user.id !== currentUser?.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deactivateMut.mutate(user.id)}
                            disabled={deactivateMut.isPending}
                          >
                            <UserMinus size={14} className="mr-1.5" />
                            Dezactivează
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ListSurface>

      {inactiveUsers.length > 0 && (
        <>
          <h2 className="mb-2 mt-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Inactivi <span className="tabular-nums">({inactiveUsers.length})</span>
          </h2>
          <ListSurface>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 bg-secondary/30 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th scope="col" className="px-4 py-3 font-medium">Nume</th>
                    <th scope="col" className="px-4 py-3 font-medium">Email</th>
                    <th scope="col" className="px-4 py-3 font-medium">Rol</th>
                    {isOwnerOrAdmin && (
                      <th scope="col" className="px-4 py-3 text-right font-medium">Acțiuni</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {inactiveUsers.map((user) => (
                    <tr
                      key={user.id}
                      className="border-b border-border/40 last:border-0 opacity-60 transition-colors hover:bg-secondary/40"
                    >
                      <td className="px-4 py-3 font-medium">{user.fullName}</td>
                      <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={ROLE_TONES[user.role]}>{ROLE_LABELS[user.role]}</StatusBadge>
                      </td>
                      {isOwnerOrAdmin && (
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => activateMut.mutate(user.id)}
                            disabled={activateMut.isPending}
                          >
                            <UserPlus size={14} className="mr-1.5" />
                            Reactivează
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ListSurface>
        </>
      )}
    </div>
  );
}

interface InviteFormProps {
  onSuccess: () => void;
  onCancel: () => void;
}

function InviteForm({ onSuccess, onCancel }: InviteFormProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('AGENT');
  const [password, setPassword] = useState('');

  const inviteMut = useMutation({
    mutationFn: () => usersApi.invite({ email, fullName, role, password }),
    onSuccess,
  });

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Invită utilizator nou</h2>
      <form
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          inviteMut.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="invite-name">Nume complet</Label>
          <Input
            id="invite-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-email">Email</Label>
          <Input
            id="invite-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-password">Parolă temporară</Label>
          <Input
            id="invite-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
            placeholder="Minim 8 caractere"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="invite-role">Rol</Label>
          <select
            id="invite-role"
            value={role}
            onChange={(e) => setRole(e.target.value as UserRole)}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {ROLE_ORDER.filter((r) => r !== 'OWNER').map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>

        {inviteMut.isError && (
          <p className="col-span-full rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {inviteMut.error instanceof Error ? inviteMut.error.message : 'Eroare necunoscută'}
          </p>
        )}
        {inviteMut.isSuccess && (
          <p className="col-span-full rounded-md border border-accent-green/30 bg-accent-green/[0.05] px-3 py-2 text-sm text-accent-green">
            Utilizator creat cu succes.
          </p>
        )}

        <div className="col-span-full flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>Anulează</Button>
          <Button type="submit" disabled={inviteMut.isPending}>
            {inviteMut.isPending ? 'Se creează…' : 'Creează utilizator'}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}
