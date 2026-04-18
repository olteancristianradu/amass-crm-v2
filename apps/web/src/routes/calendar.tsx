import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { authedRoute } from './authed';
import { calendarApi, type CalendarProvider, type CreateEventDto } from '@/features/calendar/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const calendarRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/calendar',
  component: CalendarPage,
});

/** Returns ISO date string for today/7-days-from-now for the events default range. */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
function in7DaysIso(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

function CalendarPage(): JSX.Element {
  const [showEventForm, setShowEventForm] = useState(false);
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(in7DaysIso());

  const { data: integrations, isLoading: loadingInt } = useQuery({
    queryKey: ['calendar', 'integrations'],
    queryFn: () => calendarApi.listIntegrations(),
  });

  const { data: events, isLoading: loadingEv, isError: evError, error: evErr } = useQuery({
    queryKey: ['calendar', 'events', from, to],
    queryFn: () => calendarApi.listEvents(from, to),
  });

  const connectMut = useMutation({
    mutationFn: (provider: CalendarProvider) => calendarApi.connect(provider),
    onSuccess: (res) => {
      // Redirect user to OAuth flow
      window.location.href = res.url;
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Calendar</h1>
        <Button onClick={() => setShowEventForm((v) => !v)}>
          {showEventForm ? 'Anulează' : '+ Eveniment nou'}
        </Button>
      </div>

      {showEventForm && (
        <NewEventForm
          integrations={integrations ?? []}
          onDone={() => setShowEventForm(false)}
        />
      )}

      {/* Integrations */}
      <div>
        <h2 className="text-lg font-medium mb-3">Integrări calendar</h2>
        {loadingInt && (
          <div className="grid gap-3 sm:grid-cols-2">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        )}
        {!loadingInt && (
          <div className="flex flex-wrap gap-3">
            {(integrations ?? []).map((intg) => (
              <Card key={intg.id} className="w-full sm:w-64">
                <CardContent className="py-3 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">
                      {intg.provider === 'GOOGLE' ? 'Google Calendar' : 'Outlook Calendar'}
                    </p>
                    <p className="text-xs text-muted-foreground">{intg.accountEmail}</p>
                  </div>
                  <span
                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                      intg.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {intg.isActive ? 'Activ' : 'Inactiv'}
                  </span>
                </CardContent>
              </Card>
            ))}

            {/* Connect buttons for providers not yet connected */}
            {(['GOOGLE', 'OUTLOOK'] as CalendarProvider[])
              .filter(
                (p) => !(integrations ?? []).some((i) => i.provider === p && i.isActive),
              )
              .map((provider) => (
                <Button
                  key={provider}
                  variant="outline"
                  disabled={connectMut.isPending}
                  onClick={() => connectMut.mutate(provider)}
                >
                  {connectMut.isPending ? 'Redirecționare…' : `Conectează ${provider === 'GOOGLE' ? 'Google' : 'Outlook'}`}
                </Button>
              ))}
          </div>
        )}
      </div>

      {/* Events */}
      <div>
        <div className="flex items-center gap-4 mb-3 flex-wrap">
          <h2 className="text-lg font-medium">Evenimente</h2>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-36 text-sm"
            />
            <span className="text-muted-foreground text-sm">→</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-36 text-sm"
            />
          </div>
        </div>

        {loadingEv && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="animate-pulse h-14 bg-gray-200 rounded" />
            ))}
          </div>
        )}
        {evError && (
          <p className="text-sm text-destructive">
            Eroare: {evErr instanceof ApiError ? evErr.message : 'necunoscută'}
          </p>
        )}

        {events && (
          <div className="space-y-2">
            {events.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Niciun eveniment în intervalul selectat.
              </p>
            )}
            {events.map((ev) => (
              <Card key={ev.id}>
                <CardContent className="py-3 flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-sm">{ev.title}</p>
                    {ev.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {ev.description}
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0 text-right">
                    <p>{new Date(ev.startAt).toLocaleDateString('ro-RO')}</p>
                    <p>
                      {new Date(ev.startAt).toLocaleTimeString('ro-RO', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      –{' '}
                      {new Date(ev.endAt).toLocaleTimeString('ro-RO', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface NewEventFormProps {
  integrations: { id: string; provider: string; accountEmail: string }[];
  onDone: () => void;
}

function NewEventForm({ integrations, onDone }: NewEventFormProps): JSX.Element {
  const qc = useQueryClient();
  const [form, setForm] = useState<CreateEventDto>({
    integrationId: integrations[0]?.id ?? '',
    title: '',
    startAt: '',
    endAt: '',
  });
  const [formError, setFormError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: (dto: CreateEventDto) => calendarApi.createEvent(dto),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['calendar', 'events'] });
      onDone();
    },
    onError: (err: unknown) => {
      setFormError(err instanceof ApiError ? err.message : 'Eroare la creare');
    },
  });

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    setFormError(null);
    if (!form.title.trim()) {
      setFormError('Titlul este obligatoriu.');
      return;
    }
    if (!form.startAt || !form.endAt) {
      setFormError('Data de start și de sfârșit sunt obligatorii.');
      return;
    }
    if (new Date(form.startAt) >= new Date(form.endAt)) {
      setFormError('Data de start trebuie să fie înainte de data de sfârșit.');
      return;
    }
    createMut.mutate({ ...form, title: form.title.trim() });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Eveniment nou</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-3 md:grid-cols-2">
          <div className="md:col-span-2 space-y-1">
            <Label htmlFor="ev-title">Titlu *</Label>
            <Input
              id="ev-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-start">Start *</Label>
            <Input
              id="ev-start"
              type="datetime-local"
              value={form.startAt}
              onChange={(e) => setForm((f) => ({ ...f, startAt: e.target.value }))}
              required
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-end">Sfârșit *</Label>
            <Input
              id="ev-end"
              type="datetime-local"
              value={form.endAt}
              onChange={(e) => setForm((f) => ({ ...f, endAt: e.target.value }))}
              required
            />
          </div>
          {integrations.length > 0 && (
            <div className="space-y-1">
              <Label htmlFor="ev-intg">Calendar *</Label>
              <select
                id="ev-intg"
                value={form.integrationId}
                onChange={(e) => setForm((f) => ({ ...f, integrationId: e.target.value }))}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                {integrations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.provider} — {i.accountEmail}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="md:col-span-2">
            {formError && (
              <p className="mb-2 text-sm text-destructive">{formError}</p>
            )}
            {integrations.length === 0 && (
              <p className="mb-2 text-sm text-yellow-600">
                Conectează întâi un calendar pentru a putea crea evenimente.
              </p>
            )}
            <Button type="submit" disabled={createMut.isPending || integrations.length === 0}>
              {createMut.isPending ? 'Se salvează…' : 'Salvează'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
