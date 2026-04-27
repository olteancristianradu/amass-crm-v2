import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Trash2, Webhook } from 'lucide-react';
import { authedRoute } from './authed';
import { webhooksApi, WEBHOOK_EVENTS, type CreateWebhookEndpointDto } from '@/features/webhooks/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
} from '@/components/ui/page-header';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const settingsWebhooksRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/webhooks',
  component: SettingsWebhooksPage,
});

function SettingsWebhooksPage(): JSX.Element {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: endpoints, isLoading, isError, error } = useQuery({
    queryKey: ['webhooks', 'endpoints'],
    queryFn: () => webhooksApi.listEndpoints(),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      webhooksApi.updateEndpoint(id, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks', 'endpoints'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => webhooksApi.deleteEndpoint(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['webhooks', 'endpoints'] }),
  });

  function handleDelete(id: string, url: string): void {
    if (!confirm(`Ștergi endpoint-ul ${url}?`)) return;
    deleteMut.mutate(id);
  }

  return (
    <div>
      <PageHeader
        title="Webhook-uri"
        subtitle="Endpoints HTTP care primesc evenimente din CRM (deal.created, invoice.paid etc.). Semnătura HMAC SHA-256 e în antet."
        actions={
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <Plus size={14} className="mr-1.5" />
            {showForm ? 'Anulează' : 'Endpoint nou'}
          </Button>
        }
      />

      {showForm && <NewWebhookForm onDone={() => setShowForm(false)} />}

      {isLoading && (
        <GlassCard className="overflow-hidden">
          <TableSkeleton rows={3} cols={4} />
        </GlassCard>
      )}
      {isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {endpoints && endpoints.length === 0 && !showForm && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={Webhook}
            title="Niciun webhook configurat"
            description="Adaugă un endpoint HTTPS pentru a primi evenimentele CRM (creare/update/șterge) în propriul tău sistem extern."
            action={
              <Button size="sm" onClick={() => setShowForm(true)}>
                <Plus size={14} className="mr-1.5" /> Endpoint nou
              </Button>
            }
          />
        </GlassCard>
      )}

      {endpoints && endpoints.length > 0 && (
        <div className="space-y-2">
          {endpoints.map((ep) => (
            <GlassCard key={ep.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate font-mono text-sm font-medium">{ep.url}</p>
                    <StatusBadge tone={ep.isActive ? 'green' : 'neutral'}>
                      {ep.isActive ? 'Activ' : 'Inactiv'}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Evenimente: {ep.events.length === 0 ? 'toate' : ep.events.join(', ')}
                  </p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    Creat la {new Date(ep.createdAt).toLocaleDateString('ro-RO')}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggleMut.isPending}
                    onClick={() => toggleMut.mutate({ id: ep.id, isActive: !ep.isActive })}
                  >
                    {ep.isActive ? 'Dezactivează' : 'Activează'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteMut.isPending}
                    onClick={() => handleDelete(ep.id, ep.url)}
                    aria-label="Șterge endpoint"
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}

function NewWebhookForm({ onDone }: { onDone: () => void }): JSX.Element {
  const qc = useQueryClient();
  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());
  const [formError, setFormError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (dto: CreateWebhookEndpointDto) => webhooksApi.createEndpoint(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['webhooks', 'endpoints'] });
      onDone();
    },
    onError: (err: unknown) => {
      setFormError(err instanceof ApiError ? err.message : 'Eroare la creare');
    },
  });

  function toggleEvent(event: string): void {
    setSelectedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event);
      else next.add(event);
      return next;
    });
  }

  function handleSelectAll(): void {
    if (selectedEvents.size === WEBHOOK_EVENTS.length) setSelectedEvents(new Set());
    else setSelectedEvents(new Set(WEBHOOK_EVENTS));
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setFormError(null);
    if (!url.trim()) {
      setFormError('URL-ul este obligatoriu.');
      return;
    }
    try {
      new URL(url.trim());
    } catch {
      setFormError('URL-ul introdus nu este valid.');
      return;
    }
    createMut.mutate({ url: url.trim(), events: [...selectedEvents] });
  }

  const allSelected = selectedEvents.size === WEBHOOK_EVENTS.length;

  return (
    <GlassCard className="mb-4 p-6">
      <h2 className="mb-4 text-lg font-medium">Endpoint nou</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor="wh-url">URL *</Label>
          <Input
            id="wh-url"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/webhook"
            required
            className="font-mono text-xs"
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Evenimente</Label>
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs text-foreground underline-offset-4 hover:underline"
            >
              {allSelected ? 'Deselectează toate' : 'Selectează toate'}
            </button>
          </div>
          <div className="grid max-h-48 grid-cols-2 gap-2 overflow-y-auto rounded-md border border-border/70 bg-card/50 p-3 sm:grid-cols-3">
            {WEBHOOK_EVENTS.map((ev) => (
              <label key={ev} className="flex cursor-pointer items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={selectedEvents.has(ev)}
                  onChange={() => toggleEvent(ev)}
                  className="rounded"
                />
                <span className="font-mono">{ev}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {selectedEvents.size === 0
              ? 'Niciun eveniment selectat — webhook-ul va primi toate evenimentele.'
              : `${selectedEvents.size} eveniment${selectedEvents.size === 1 ? '' : 'e'} selectate`}
          </p>
        </div>

        {formError && (
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {formError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onDone}>
            Anulează
          </Button>
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Se salvează…' : 'Salvează'}
          </Button>
        </div>
      </form>
    </GlassCard>
  );
}
