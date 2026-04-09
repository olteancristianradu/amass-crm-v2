import { useQuery } from '@tanstack/react-query';
import { notesApi } from './api';
import type { SubjectType, TimelineItem } from '@/lib/types';

interface Props {
  subjectType: SubjectType;
  subjectId: string;
}

export function TimelineTab({ subjectType, subjectId }: Props): JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['timeline', subjectType, subjectId],
    queryFn: () => notesApi.timeline(subjectType, subjectId, undefined, 50),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Se încarcă…</p>;
  if (!data || data.data.length === 0) {
    return <p className="text-sm text-muted-foreground">Fără activitate.</p>;
  }

  return (
    <ol className="space-y-3 border-l-2 border-muted pl-6">
      {data.data.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="relative">
          <span className="absolute -left-[31px] top-1 h-3 w-3 rounded-full border-2 border-background bg-primary" />
          <TimelineEntry item={item} />
        </li>
      ))}
    </ol>
  );
}

function TimelineEntry({ item }: { item: TimelineItem }): JSX.Element {
  const when = new Date(item.createdAt).toLocaleString('ro-RO');
  if (item.kind === 'note') {
    return (
      <div className="space-y-1">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Notă</div>
        <p className="whitespace-pre-wrap text-sm">{item.body}</p>
        <p className="text-xs text-muted-foreground">{when}</p>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">Activitate</div>
      <p className="text-sm font-medium">{formatAction(item.action)}</p>
      <p className="text-xs text-muted-foreground">{when}</p>
    </div>
  );
}

function formatAction(action: string): string {
  // Translate common action keys to Romanian labels. Unknown actions fall
  // through to the raw key so the UI never silently drops information.
  const map: Record<string, string> = {
    'company.created': 'Companie creată',
    'company.updated': 'Companie actualizată',
    'company.deleted': 'Companie ștearsă',
    'contact.created': 'Contact creat',
    'contact.updated': 'Contact actualizat',
    'contact.deleted': 'Contact șters',
    'client.created': 'Client creat',
    'client.updated': 'Client actualizat',
    'note.added': 'Notă adăugată',
    'note.updated': 'Notă actualizată',
    'note.deleted': 'Notă ștearsă',
    'attachment.added': 'Fișier atașat',
    'attachment.deleted': 'Fișier șters',
    'reminder.created': 'Reminder programat',
    'reminder.fired': 'Reminder declanșat',
    'reminder.dismissed': 'Reminder închis',
  };
  return map[action] ?? action;
}
