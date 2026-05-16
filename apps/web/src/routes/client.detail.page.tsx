import { Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Users } from 'lucide-react';
import { clientsApi } from '@/features/clients/api';
import { NextActionHeader } from '@/features/entity-detail/NextActionHeader';
import { RelationshipHealthCard } from '@/features/entity-detail/RelationshipHealthCard';
import { ListSkeleton } from '@/components/ui/loading-skeleton';
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
import { useTour } from '@/lib/tours/useTour';
import { usePresence } from '@/features/sync/usePresence';
import { PresenceBadge } from '@/features/sync/PresenceBadge';
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
  useTour('client-detail');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['clients', 'detail', id],
    queryFn: () => clientsApi.get(id),
  });
  // B1-PR4: presence indicator.
  const { viewerUserIds } = usePresence('client', id);

  if (isLoading) return <ListSkeleton rows={4} />;
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

  const initials =
    `${(data.firstName ?? '').charAt(0)}${(data.lastName ?? '').charAt(0)}`.toUpperCase() || '·';

  return (
    <DetailLayout
      title={
        <span data-tour="client-header" className="inline-flex items-center gap-3">
          <span
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-foreground"
            aria-hidden="true"
          >
            {initials}
          </span>
          <span>
            {data.firstName} {data.lastName}
          </span>
          <Users size={16} className="text-muted-foreground" aria-hidden="true" />
          <PresenceBadge viewerUserIds={viewerUserIds} />
        </span>
      }
      subtitle={
        <>
          {data.email && <span>{data.email}</span>}
          {data.email && data.city && <span aria-hidden="true">·</span>}
          {data.city && <span>{data.city}</span>}
        </>
      }
      backHref="/app/clients"
      backLabel="Clienți"
      sidebar={
        <>
          <div data-tour="client-health">
            <RelationshipHealthCard entityType="CLIENT" entityId={id} />
          </div>
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
      <div data-tour="client-next-action">
        <NextActionHeader entityType="CLIENT" entityId={id} />
      </div>
      <div data-tour="client-tabs">
        <TabBar tabs={TABS} value={tab} onChange={setTab} />
      </div>
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
