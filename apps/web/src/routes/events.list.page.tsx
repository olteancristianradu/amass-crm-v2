import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Calendar } from 'lucide-react';
import { eventsApi, type EventKind } from '@/features/events/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { ApiError } from '@/lib/api';
import { QueryError } from '@/components/ui/QueryError';

const KIND_LABELS: Record<EventKind, string> = {
  CONFERENCE: 'Conferință', WEBINAR: 'Webinar', WORKSHOP: 'Workshop', MEETUP: 'Meetup',
};

export function EventsPage(): JSX.Element {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EventKind>('CONFERENCE');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [location, setLocation] = useState('');
  const [capacity, setCapacity] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data, isError, error: queryError } = useQuery({ queryKey: ['events'], queryFn: () => eventsApi.list() });

  const createMut = useMutation({
    mutationFn: () => eventsApi.create({
      name, kind, startAt, endAt,
      location: location || undefined,
      capacity: capacity ? Number(capacity) : undefined,
    }),
    onSuccess: async () => {
      setName(''); setStartAt(''); setEndAt(''); setLocation(''); setCapacity('');
      await qc.invalidateQueries({ queryKey: ['events'] });
    },
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Eroare.'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => eventsApi.delete(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['events'] }),
  });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Evenimente"
        subtitle="Webinare, conferințe și meetup-uri cu tracking participanți."
      />

      <Card>
        <CardHeader><CardTitle className="text-lg">Eveniment nou</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={(e) => { e.preventDefault(); setError(null); createMut.mutate(); }} className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1 md:col-span-2"><Label>Nume</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="space-y-1">
              <Label>Tip</Label>
              <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} className="h-9 w-full rounded-md border border-input px-3 text-sm">
                {(Object.entries(KIND_LABELS) as [EventKind, string][]).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="space-y-1"><Label>Capacitate</Label><Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></div>
            <div className="space-y-1"><Label>Start</Label><Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} required /></div>
            <div className="space-y-1"><Label>Sfârșit</Label><Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} required /></div>
            <div className="space-y-1 md:col-span-2"><Label>Locație</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} /></div>
            <div className="md:col-span-2">
              {error && <p className="mb-2 text-sm text-destructive">{error}</p>}
              <Button type="submit" disabled={createMut.isPending}>Creează</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <QueryError isError={isError} error={queryError} label="Nu am putut încărca evenimentele." />

      {(data ?? []).length === 0 ? (
        <Card>
          <EmptyState
            icon={Calendar}
            title="Niciun eveniment programat"
            description="Adaugă evenimente (webinare, târguri, demo-uri) pentru tracking participanți."
          />
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left">
                <tr>
                  <th scope="col" className="px-4 py-2">Nume</th>
                  <th scope="col" className="px-4 py-2">Tip</th>
                  <th scope="col" className="px-4 py-2">Start</th>
                  <th scope="col" className="px-4 py-2">Sfârșit</th>
                  <th scope="col" className="px-4 py-2">Locație</th>
                  <th scope="col" className="px-4 py-2 text-right">Capacitate</th>
                  <th scope="col" className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {(data ?? []).map((e) => (
                  <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{e.name}</td>
                    <td className="px-4 py-2 text-xs">{KIND_LABELS[e.kind]}</td>
                    <td className="px-4 py-2 text-xs">{new Date(e.startAt).toLocaleString('ro-RO')}</td>
                    <td className="px-4 py-2 text-xs">{new Date(e.endAt).toLocaleString('ro-RO')}</td>
                    <td className="px-4 py-2 text-xs">{e.location ?? '—'}</td>
                    <td className="px-4 py-2 text-right">{e.capacity ?? '—'}</td>
                    <td className="px-4 py-2">
                      <Button size="sm" variant="ghost" onClick={() => { if (confirm('Ștergi evenimentul?')) deleteMut.mutate(e.id); }}>×</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
