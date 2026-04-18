import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { webhooksApi, WEBHOOK_EVENTS, type CreateWebhookEndpointDto } from '@/features/webhooks/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['webhooks', 'endpoints'] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => webhooksApi.deleteEndpoint(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['webhooks', 'endpoints'] });
    },
  });

  function handleDelete(id: string, url: string): void {
    if (!confirm(`Ștergi endpoint-ul ${url}?`)) return;
    deleteMut.mutate(id);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Webhook-uri</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Anulează' : '+ Endpoint nou'}
        </Button>
      </div>

      {showForm && <NewWebhookForm onDone={() => setShowForm(false)} />}

      {isLoading && (
        <Card>
          <TableSkeleton rows={3} cols={4} />
        </Card>
      )}
      {isError && (
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {endpoints && endpoints.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground">
          Niciun webhook configurat. Adaugă un endpoint pentru a primi notificări HTTP la evenimentele CRM.
        </p>
      )}

      {endpoints && endpoints.length > 0 && (
        <div className="space-y-3">
          {endpoints.map((ep) => (
            <Card key={ep.id}>
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-mono text-sm font-medium truncate">{ep.url}</p>
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium shrink-0 ${
                          ep.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {ep.isActive ? 'Activ' : 'Inactiv'}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Evenimente: {ep.events.length === 0 ? 'toate' : ep.events.join(', ')}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Creat la {new Date(ep.createdAt).toLocaleDateString('ro-RO')}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
                      className="text-destructive hover:text-destructive"
                      disabled={deleteMut.isPending}
                      onClick={() => handleDelete(ep.id, ep.url)}
                    >
                      Șterge
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
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
      if (next.has(event)) {
        next.delete(event);
      } else {
        next.add(event);
      }
      return next;
    });
  }

  function handleSelectAll(): void {
    if (selectedEvents.size === WEBHOOK_EVENTS.length) {
      setSelectedEvents(new Set());
    } else {
      setSelectedEvents(new Set(WEBHOOK_EVENTS));
    }
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
    createMut.mutate({
      url: url.trim(),
      events: [...selectedEvents],
    });
  }

  const allSelected = selectedEvents.size === WEBHOOK_EVENTS.length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Endpoint nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="wh-url">URL *</Label>
            <Input
              id="wh-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/webhook"
              required
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Evenimente</Label>
              <button
                type="button"
                onClick={handleSelectAll}
                className="text-xs text-primary hover:underline"
              >
                {allSelected ? 'Deselectează toate' : 'Selectează toate'}
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-2 border rounded-md">
              {WEBHOOK_EVENTS.map((ev) => (
                <label key={ev} className="flex items-center gap-1.5 text-xs cursor-pointer">
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
            <p className="text-sm text-destructive">{formError}</p>
          )}
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Se salvează…' : 'Salvează'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
