import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Gestiune utilizatori</h1>
        {isOwnerOrAdmin && (
          <Button onClick={() => setShowInvite(!showInvite)}>
            {showInvite ? 'Anulează' : 'Invită utilizator'}
          </Button>
        )}
      </div>

      {showInvite && isOwnerOrAdmin && (
        <InviteForm
          onSuccess={() => {
            setShowInvite(false);
            qc.invalidateQueries({ queryKey: ['users'] });
          }}
        />
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}

      {/* Active users table */}
      <Card>
        <CardHeader>
          <CardTitle>Utilizatori activi ({activeUsers.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="pb-2 font-medium">Nume</th>
                  <th scope="col" className="pb-2 font-medium">Email</th>
                  <th scope="col" className="pb-2 font-medium">Rol</th>
                  <th scope="col" className="pb-2 font-medium">Adăugat</th>
                  {isOwnerOrAdmin && <th scope="col" className="pb-2 font-medium">Acțiuni</th>}
                </tr>
              </thead>
              <tbody className="divide-y">
                {activeUsers.map((user) => (
                  <tr key={user.id}>
                    <td className="py-2 font-medium">{user.fullName}</td>
                    <td className="py-2 text-muted-foreground">{user.email}</td>
                    <td className="py-2">
                      {isOwnerOrAdmin && user.id !== currentUser?.id ? (
                        <select
                          value={user.role}
                          onChange={(e) =>
                            roleMut.mutate({ id: user.id, role: e.target.value as UserRole })
                          }
                          disabled={roleMut.isPending}
                          className="h-7 rounded border border-input bg-background px-2 text-xs"
                        >
                          {ROLE_ORDER.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <RoleBadge role={user.role} />
                      )}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString('ro-RO')}
                    </td>
                    {isOwnerOrAdmin && (
                      <td className="py-2">
                        {user.id !== currentUser?.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => deactivateMut.mutate(user.id)}
                            disabled={deactivateMut.isPending}
                          >
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
        </CardContent>
      </Card>

      {/* Inactive users */}
      {inactiveUsers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground">
              Utilizatori inactivi ({inactiveUsers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th scope="col" className="pb-2 font-medium">Nume</th>
                    <th scope="col" className="pb-2 font-medium">Email</th>
                    <th scope="col" className="pb-2 font-medium">Rol</th>
                    {isOwnerOrAdmin && <th scope="col" className="pb-2 font-medium">Acțiuni</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {inactiveUsers.map((user) => (
                    <tr key={user.id} className="opacity-60">
                      <td className="py-2 font-medium">{user.fullName}</td>
                      <td className="py-2">{user.email}</td>
                      <td className="py-2">
                        <RoleBadge role={user.role} />
                      </td>
                      {isOwnerOrAdmin && (
                        <td className="py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => activateMut.mutate(user.id)}
                            disabled={activateMut.isPending}
                          >
                            Reactivează
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

interface InviteFormProps {
  onSuccess: () => void;
}

function InviteForm({ onSuccess }: InviteFormProps): JSX.Element {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('AGENT');
  const [password, setPassword] = useState('');

  const inviteMut = useMutation({
    mutationFn: () => usersApi.invite({ email, fullName, role, password }),
    onSuccess,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invită utilizator nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            inviteMut.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="invite-name">Nume complet</Label>
            <Input
              id="invite-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
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
          <div className="space-y-1">
            <Label htmlFor="invite-role">Rol</Label>
            <select
              id="invite-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {ROLE_ORDER.filter((r) => r !== 'OWNER').map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          {inviteMut.isError && (
            <p className="col-span-full text-sm text-destructive">
              {inviteMut.error instanceof Error ? inviteMut.error.message : 'Eroare necunoscută'}
            </p>
          )}
          {inviteMut.isSuccess && (
            <p className="col-span-full text-sm text-primary">Utilizator creat cu succes!</p>
          )}

          <div className="col-span-full">
            <Button type="submit" disabled={inviteMut.isPending}>
              {inviteMut.isPending ? 'Se creează…' : 'Creează utilizator'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

const ROLE_COLORS: Record<UserRole, string> = {
  OWNER: 'bg-purple-100 text-purple-800',
  ADMIN: 'bg-blue-100 text-blue-800',
  MANAGER: 'bg-green-100 text-green-800',
  AGENT: 'bg-secondary text-foreground',
  VIEWER: 'bg-muted text-muted-foreground',
};

function RoleBadge({ role }: { role: UserRole }): JSX.Element {
  return (
    <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${ROLE_COLORS[role]}`}>
      {ROLE_LABELS[role]}
    </span>
  );
}
