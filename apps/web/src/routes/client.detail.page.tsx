import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Users } from 'lucide-react';
import { clientsApi } from '@/features/clients/api';
import { DetailField, DetailFields, DetailLayout, TabBar } from '@/components/ui/detail-layout';
import { NotesTab } from '@/features/notes/NotesTab';
import { TimelineTab } from '@/features/notes/TimelineTab';
import { RemindersTab } from '@/features/reminders/RemindersTab';
import { AttachmentsTab } from '@/features/attachments/AttachmentsTab';
import { TasksTab } from '@/features/tasks/TasksTab';
import { EmailTab } from '@/features/email/EmailTab';
import { CallsTab } from '@/features/calls/CallsTab';
import { GdprPanel } from '@/features/gdpr/GdprPanel';
import { ApiError } from '@/lib/api';
import { clientDetailRoute } from './client.detail';

type TabKey = 'timeline' | 'notes' | 'tasks' | 'reminders' | 'email' | 'calls' | 'attachments';

const TABS: { value: TabKey; label: string }[] = [
  { value: 'timeline', label: 'Cronologie' },
  { value: 'calls', label: 'Apeluri' },
  { value: 'notes', label: 'Note' },
  { value: 'tasks', label: 'Task-uri' },
  { value: 'reminders', label: 'Reminder-uri' },
  { value: 'email', label: 'Email' },
  { value: 'attachments', label: 'Fișiere' },
];

export function ClientDetailPage(): JSX.Element {
  const { id } = clientDetailRoute.useParams();
  const [tab, setTab] = useState<TabKey>('timeline');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['clients', 'detail', id],
    queryFn: () => clientsApi.get(id),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Se încarcă…</p>;
  if (isError) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
        <Link to="/app/clients" className="text-sm text-foreground underline-offset-4 hover:underline">
          ← Înapoi la Clienți
        </Link>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Clientul nu există.</p>;

  return (
    <DetailLayout
      title={
        <span className="inline-flex items-center gap-2">
          <Users size={20} className="text-muted-foreground" />
          {data.firstName} {data.lastName}
        </span>
      }
      subtitle={
        <>
          {data.email ?? 'Fără email'}
          {' · '}
          {data.city ?? 'Oraș nespecificat'}
        </>
      }
      backHref="/app/clients"
      backLabel="Clienți"
      sidebar={
        <>
          <DetailFields title="Persoană">
            <DetailField label="Prenume" value={data.firstName} />
            <DetailField label="Nume" value={data.lastName} />
          </DetailFields>
          <DetailFields title="Contact">
            <DetailField label="Email" value={data.email} />
            <DetailField label="Telefon" value={data.phone} copyable />
            <DetailField label="Mobil" value={data.mobile} copyable />
          </DetailFields>
          <DetailFields title="Adresă">
            <DetailField label="Stradă" value={data.addressLine} />
            <DetailField label="Oraș" value={data.city} />
            <DetailField label="Județ" value={data.county} />
            <DetailField label="Cod poștal" value={data.postalCode} copyable />
            <DetailField label="Țară" value={data.country} />
          </DetailFields>
          <GdprPanel kind="clients" subjectId={id} />
        </>
      }
    >
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      <div>
        {tab === 'timeline' && <TimelineTab subjectType="CLIENT" subjectId={id} />}
        {tab === 'notes' && <NotesTab subjectType="CLIENT" subjectId={id} />}
        {tab === 'tasks' && <TasksTab subjectType="CLIENT" subjectId={id} />}
        {tab === 'reminders' && <RemindersTab subjectType="CLIENT" subjectId={id} />}
        {tab === 'email' && <EmailTab subjectType="CLIENT" subjectId={id} />}
        {tab === 'calls' && <CallsTab subjectType="CLIENT" subjectId={id} />}
        {tab === 'attachments' && <AttachmentsTab subjectType="CLIENT" subjectId={id} />}
      </div>
    </DetailLayout>
  );
}
