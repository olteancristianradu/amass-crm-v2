import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { authedRoute } from './authed';
import { companiesApi } from '@/features/companies/api';
import { DetailField, DetailFields, DetailLayout, TabBar } from '@/components/ui/detail-layout';
import { NotesTab } from '@/features/notes/NotesTab';
import { TimelineTab } from '@/features/notes/TimelineTab';
import { RemindersTab } from '@/features/reminders/RemindersTab';
import { InvoicesTab } from '@/features/invoices/InvoicesTab';
import { AttachmentsTab } from '@/features/attachments/AttachmentsTab';
import { TasksTab } from '@/features/tasks/TasksTab';
import { DealsTab } from '@/features/deals/DealsTab';
import { SubsidiariesTab } from '@/features/companies/SubsidiariesTab';
import { EmailTab } from '@/features/email/EmailTab';
import { CallsTab } from '@/features/calls/CallsTab';
import { ApiError } from '@/lib/api';

export const companyDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/companies/$id',
  component: CompanyDetailPage,
});

type TabKey =
  | 'timeline'
  | 'notes'
  | 'deals'
  | 'tasks'
  | 'reminders'
  | 'email'
  | 'calls'
  | 'attachments'
  | 'invoices'
  | 'subsidiaries';

const TABS: { value: TabKey; label: string }[] = [
  { value: 'timeline', label: 'Cronologie' },
  { value: 'calls', label: 'Apeluri' },
  { value: 'notes', label: 'Note' },
  { value: 'deals', label: 'Deal-uri' },
  { value: 'tasks', label: 'Task-uri' },
  { value: 'reminders', label: 'Reminder-uri' },
  { value: 'email', label: 'Email' },
  { value: 'attachments', label: 'Fișiere' },
  { value: 'invoices', label: 'Facturi' },
  { value: 'subsidiaries', label: 'Subsidiare' },
];

function CompanyDetailPage(): JSX.Element {
  const { id } = companyDetailRoute.useParams();
  const [tab, setTab] = useState<TabKey>('timeline');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['companies', 'detail', id],
    queryFn: () => companiesApi.get(id),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Se încarcă…</p>;
  if (isError) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
        <Link to="/app/companies" className="text-sm text-foreground underline-offset-4 hover:underline">
          ← Înapoi la listă
        </Link>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Compania nu există.</p>;

  return (
    <DetailLayout
      title={
        <span className="inline-flex items-center gap-2">
          <Building2 size={20} className="text-muted-foreground" />
          {data.name}
        </span>
      }
      subtitle={
        <>
          {data.industry ?? 'Industrie nespecificată'}
          {' · '}
          {data.city ?? 'Oraș nespecificat'}
        </>
      }
      backHref="/app/companies"
      backLabel="Companii"
      sidebar={
        <>
          <DetailFields title="Identificare">
            <DetailField label="CUI" value={data.vatNumber} copyable />
            <DetailField label="Reg. com." value={data.registrationNumber} copyable />
          </DetailFields>
          <DetailFields title="Contact">
            <DetailField label="Email" value={data.email} />
            <DetailField label="Telefon" value={data.phone} copyable />
            <DetailField label="Website" value={data.website} />
          </DetailFields>
          <DetailFields title="Adresă">
            <DetailField label="Stradă" value={data.addressLine} />
            <DetailField label="Oraș" value={data.city} />
            <DetailField label="Județ" value={data.county} />
            <DetailField label="Cod poștal" value={data.postalCode} copyable />
            <DetailField label="Țară" value={data.country} />
          </DetailFields>
          {data.parentId && (
            <DetailFields title="Ierarhie">
              <ParentLink parentId={data.parentId} />
            </DetailFields>
          )}
        </>
      }
    >
      <TabBar tabs={TABS} value={tab} onChange={setTab} />
      <div>
        {tab === 'timeline' && <TimelineTab subjectType="COMPANY" subjectId={id} />}
        {tab === 'notes' && <NotesTab subjectType="COMPANY" subjectId={id} />}
        {tab === 'deals' && <DealsTab companyId={id} />}
        {tab === 'tasks' && <TasksTab subjectType="COMPANY" subjectId={id} />}
        {tab === 'reminders' && <RemindersTab subjectType="COMPANY" subjectId={id} />}
        {tab === 'email' && <EmailTab subjectType="COMPANY" subjectId={id} />}
        {tab === 'calls' && <CallsTab subjectType="COMPANY" subjectId={id} />}
        {tab === 'attachments' && <AttachmentsTab subjectType="COMPANY" subjectId={id} />}
        {tab === 'invoices' && <InvoicesTab companyId={id} />}
        {tab === 'subsidiaries' && <SubsidiariesTab companyId={id} />}
      </div>
    </DetailLayout>
  );
}

function ParentLink({ parentId }: { parentId: string }): JSX.Element {
  const { data } = useQuery({
    queryKey: ['companies', 'detail', parentId],
    queryFn: () => companiesApi.get(parentId),
  });
  return (
    <DetailField
      label="Companie-mamă"
      value={
        <Link
          to="/app/companies/$id"
          params={{ id: parentId }}
          className="font-medium underline-offset-4 hover:underline"
        >
          {data?.name ?? '…'}
        </Link>
      }
    />
  );
}
