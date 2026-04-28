import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { campaignsApi, type CampaignChannel, type CampaignStatus } from '@/features/campaigns/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';
import { statusBadgeClasses, type StatusTone } from '@/lib/status-colors';

export const campaignsListRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/campaigns',
  component: CampaignsListPage,
});

const STATUS_LABELS: Record<CampaignStatus, string> = {
  DRAFT: 'Schiță',
  ACTIVE: 'Activă',
  PAUSED: 'Întreruptă',
  COMPLETED: 'Finalizată',
};

const STATUS_TONES: Record<CampaignStatus, StatusTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  PAUSED: 'warning',
  COMPLETED: 'info',
};

const CHANNEL_LABELS: Record<CampaignChannel, string> = {
  EMAIL: 'Email',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  MIXED: 'Multi-canal',
};

function NewCampaignForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [channel, setChannel] = useState<CampaignChannel>('EMAIL');
  const [budget, setBudget] = useState('');
  const [targetCount, setTargetCount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () =>
      campaignsApi.create({
        name,
        description: description || undefined,
        channel,
        budget: budget || undefined,
        targetCount: targetCount ? Number(targetCount) : 0,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['campaigns'] });
      onDone();
    },
    onError: (err: unknown) => {
      setError(err instanceof ApiError ? err.message : 'Eroare la creare.');
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Campanie nouă</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => { e.preventDefault(); setError(null); mut.mutate(); }}
          className="grid gap-3 md:grid-cols-2"
        >
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="cmp-name">Nume *</Label>
            <Input id="cmp-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="cmp-desc">Descriere</Label>
            <textarea
              id="cmp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cmp-channel">Canal</Label>
            <select
              id="cmp-channel"
              value={channel}
              onChange={(e) => setChannel(e.target.value as CampaignChannel)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {(Object.entries(CHANNEL_LABELS) as [CampaignChannel, string][]).map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cmp-budget">Buget</Label>
            <Input id="cmp-budget" inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="0.00" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cmp-target">Target (contacte)</Label>
            <Input id="cmp-target" type="number" value={targetCount} onChange={(e) => setTargetCount(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cmp-start">Start</Label>
            <Input id="cmp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="cmp-end">Sfârșit</Label>
            <Input id="cmp-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={mut.isPending || !name.trim()}>
              {mut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function CampaignsListPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [filterStatus, setFilterStatus] = useState<CampaignStatus | ''>('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['campaigns', { filterStatus }],
    queryFn: () => campaignsApi.list({ status: filterStatus || undefined, limit: 50 }),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: CampaignStatus }) =>
      campaignsApi.update(id, { status }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => campaignsApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['campaigns'] }),
  });

  const rows = data?.data ?? [];
  const active = rows.filter((c) => c.status === 'ACTIVE').length;
  const totalSent = rows.reduce((s, c) => s + (c.sentCount || 0), 0);
  const totalRevenue = rows.reduce((s, c) => s + Number(c.revenue || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Campanii Marketing</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Campanie nouă'}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{active}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Mesaje trimise</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totalSent.toLocaleString('ro-RO')}</div></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1"><CardTitle className="text-sm font-medium text-muted-foreground">Venit atribuit</CardTitle></CardHeader>
          <CardContent><div className="text-2xl font-bold">{totalRevenue.toLocaleString('ro-RO', { maximumFractionDigits: 0 })} RON</div></CardContent>
        </Card>
      </div>

      {showForm && <NewCampaignForm onDone={() => setShowForm(false)} />}

      <select
        value={filterStatus}
        onChange={(e) => setFilterStatus(e.target.value as CampaignStatus | '')}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      >
        <option value="">Toate statusurile</option>
        {(Object.entries(STATUS_LABELS) as [CampaignStatus, string][]).map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>

      {isLoading && <Card><TableSkeleton rows={6} cols={7} /></Card>}
      {isError && <p className="text-sm text-destructive">Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}</p>}

      {data && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-2 font-medium">Nume</th>
                  <th scope="col" className="px-4 py-2 font-medium">Canal</th>
                  <th scope="col" className="px-4 py-2 font-medium">Status</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Trimise / Target</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Conversii</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Venit</th>
                  <th scope="col" className="px-4 py-2 font-medium text-right">Buget</th>
                  <th scope="col" className="px-4 py-2 font-medium">Acțiuni</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">Nicio campanie.</td></tr>
                )}
                {rows.map((c) => {
                  const convRate = c.sentCount > 0 ? ((c.conversions / c.sentCount) * 100).toFixed(1) : '—';
                  return (
                    <tr key={c.id} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="px-4 py-2 font-medium">{c.name}</td>
                      <td className="px-4 py-2 text-xs">{CHANNEL_LABELS[c.channel]}</td>
                      <td className="px-4 py-2">
                        <select
                          value={c.status}
                          onChange={(e) => updateMut.mutate({ id: c.id, status: e.target.value as CampaignStatus })}
                          className={statusBadgeClasses(STATUS_TONES[c.status]) + ' border-0'}
                        >
                          {(Object.entries(STATUS_LABELS) as [CampaignStatus, string][]).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {c.sentCount.toLocaleString('ro-RO')} / {c.targetCount.toLocaleString('ro-RO')}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {c.conversions} ({convRate}{convRate !== '—' ? '%' : ''})
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {Number(c.revenue || 0).toLocaleString('ro-RO', { maximumFractionDigits: 0 })} {c.currency}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-xs">
                        {c.budget ? Number(c.budget).toLocaleString('ro-RO', { maximumFractionDigits: 0 }) + ' ' + c.currency : '—'}
                      </td>
                      <td className="px-4 py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={deleteMut.isPending}
                          onClick={() => { if (confirm('Ștergi campania?')) deleteMut.mutate(c.id); }}
                        >×</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
