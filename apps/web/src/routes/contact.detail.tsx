import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Contact2 } from 'lucide-react';
import { authedRoute } from './authed';
import { contactsApi } from '@/features/contacts/api';
import { DetailField, DetailFields, DetailLayout, TabBar } from '@/components/ui/detail-layout';
import { NotesTab } from '@/features/notes/NotesTab';
import { TimelineTab } from '@/features/notes/TimelineTab';
import { RemindersTab } from '@/features/reminders/RemindersTab';
import { AttachmentsTab } from '@/features/attachments/AttachmentsTab';
import { TasksTab } from '@/features/tasks/TasksTab';
import { EmailTab } from '@/features/email/EmailTab';
import { CallsTab } from '@/features/calls/CallsTab';
import { GdprPanel } from '@/features/gdpr/GdprPanel';
import { StatusBadge } from '@/components/ui/page-header';
import { ApiError } from '@/lib/api';

export const contactDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/contacts/$id',
  component: ContactDetailPage,
});

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

function ContactDetailPage(): JSX.Element {
  const { id } = contactDetailRoute.useParams();
  const [tab, setTab] = useState<TabKey>('timeline');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['contacts', 'detail', id],
    queryFn: () => contactsApi.get(id),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Se încarcă…</p>;
  if (isError) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
        <Link to="/app/contacts" className="text-sm text-foreground underline-offset-4 hover:underline">
          ← Înapoi la Contacte
        </Link>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Contactul nu există.</p>;

  const isDecider = (data as { isDecider?: boolean }).isDecider;

  return (
    <DetailLayout
      title={
        <span className="inline-flex items-center gap-2">
          <Contact2 size={20} className="text-muted-foreground" />
          {data.firstName} {data.lastName}
        </span>
      }
      subtitle={
        <span className="inline-flex items-center gap-2">
          {data.jobTitle ?? 'Funcție nespecificată'}
          {data.email && <span className="text-muted-foreground/50">·</span>}
          {data.email}
          {isDecider && <StatusBadge tone="green">Decident</StatusBadge>}
        </span>
      }
      backHref="/app/contacts"
      backLabel="Contacte"
      sidebar={
        <>
          <DetailFields title="Persoană">
            <DetailField label="Prenume" value={data.firstName} />
            <DetailField label="Nume" value={data.lastName} />
            <DetailField label="Funcție" value={data.jobTitle} />
          </DetailFields>
          <DetailFields title="Contact">
            <DetailField label="Email" value={data.email} />
            <DetailField label="Telefon" value={data.phone} copyable />
            <DetailField label="Mobil" value={data.mobile} copyable />
          </DetailFields>
          <GdprPanel kind="contacts" subjectId={id} />
        </>
      }
    >
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      <div>
        {tab === 'timeline' && <TimelineTab subjectType="CONTACT" subjectId={id} />}
        {tab === 'notes' && <NotesTab subjectType="CONTACT" subjectId={id} />}
        {tab === 'tasks' && <TasksTab subjectType="CONTACT" subjectId={id} />}
        {tab === 'reminders' && <RemindersTab subjectType="CONTACT" subjectId={id} />}
        {tab === 'email' && <EmailTab subjectType="CONTACT" subjectId={id} />}
        {tab === 'calls' && <CallsTab subjectType="CONTACT" subjectId={id} />}
        {tab === 'attachments' && <AttachmentsTab subjectType="CONTACT" subjectId={id} />}
      </div>
    </DetailLayout>
  );
}
