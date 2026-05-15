import { Link, useNavigate } from '@tanstack/react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Building2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/stores/toasts';
import { companiesApi } from '@/features/companies/api';
import { NextActionHeader } from '@/features/entity-detail/NextActionHeader';
import { RelationshipHealthCard } from '@/features/entity-detail/RelationshipHealthCard';
import { ListSkeleton } from '@/components/ui/loading-skeleton';
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
import { useTour } from '@/lib/tours/useTour';
import { companyDetailRoute } from './company.detail';

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

export function CompanyDetailPage(): JSX.Element {
  const { id } = companyDetailRoute.useParams();
  const [tab, setTab] = useState<TabKey>('timeline');
  const navigate = useNavigate();
  const qc = useQueryClient();
  useTour('company-detail');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['companies', 'detail', id],
    queryFn: () => companiesApi.get(id),
  });

  const deleteMut = useMutation({
    mutationFn: () => companiesApi.remove(id),
    onSuccess: () => {
      toast('Companie ștearsă', data?.name);
      void qc.invalidateQueries({ queryKey: ['companies'] });
      void navigate({ to: '/app/companies' });
    },
    onError: (err: unknown) => {
      toast('Eroare la ștergere', err instanceof ApiError ? err.message : 'necunoscută');
    },
  });

  function handleDelete(): void {
    if (!data) return;
    if (!confirm(`Ștergi compania "${data.name}"? Operația e reversibilă (soft delete).`)) return;
    deleteMut.mutate();
  }

  if (isLoading) return <ListSkeleton rows={4} />;
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

  // Build a 2-letter monogram from the company name. Strips diacritics
  // so "Țară SRL" → "TS" rather than the special-char fallback "·".
  const monogram = data.name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/\s+/)
    .filter((w) => /^[A-Za-z0-9]/.test(w))
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join('') || '·';

  return (
    <DetailLayout
      title={
        <span data-tour="company-header" className="inline-flex items-center gap-3">
          <span
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-sm font-semibold text-foreground"
            aria-hidden="true"
          >
            {monogram}
          </span>
          <span>{data.name}</span>
          <Building2 size={16} className="text-muted-foreground" aria-hidden="true" />
        </span>
      }
      subtitle={
        <>
          {data.industry && <span>{data.industry}</span>}
          {data.industry && data.city && <span aria-hidden="true">·</span>}
          {data.city && <span>{data.city}</span>}
        </>
      }
      backHref="/app/companies"
      backLabel="Companii"
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={deleteMut.isPending}
          aria-label="Șterge compania"
        >
          <Trash2 size={14} className="mr-1.5" />
          {deleteMut.isPending ? 'Se șterge…' : 'Șterge'}
        </Button>
      }
      sidebar={
        <>
          <div data-tour="company-health">
            <RelationshipHealthCard entityType="COMPANY" entityId={id} />
          </div>
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
      <div data-tour="company-next-action">
        <NextActionHeader entityType="COMPANY" entityId={id} />
      </div>
      <div data-tour="company-tabs">
        <TabBar tabs={TABS} value={tab} onChange={setTab} />
      </div>
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
