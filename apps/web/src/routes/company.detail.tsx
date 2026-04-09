import { createRoute, Link } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { authedRoute } from './authed';
import { companiesApi } from '@/features/companies/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NotesTab } from '@/features/notes/NotesTab';
import { TimelineTab } from '@/features/notes/TimelineTab';
import { RemindersTab } from '@/features/reminders/RemindersTab';
import { AttachmentsTab } from '@/features/attachments/AttachmentsTab';
import { TasksTab } from '@/features/tasks/TasksTab';
import { DealsTab } from '@/features/deals/DealsTab';
import { ApiError } from '@/lib/api';

export const companyDetailRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/companies/$id',
  component: CompanyDetailPage,
});

function CompanyDetailPage(): JSX.Element {
  const { id } = companyDetailRoute.useParams();

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
        <Link to="/app/companies" className="text-sm text-primary hover:underline">
          ← Înapoi la listă
        </Link>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-muted-foreground">Nu există.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link to="/app/companies" className="text-xs text-muted-foreground hover:underline">
            ← Companii
          </Link>
          <h1 className="text-2xl font-semibold">{data.name}</h1>
          <p className="text-sm text-muted-foreground">
            {data.industry ?? '—'} · {data.city ?? '—'}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Detalii</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Field label="CUI" value={data.vatNumber} />
            <Field label="Reg. com." value={data.registrationNumber} />
            <Field label="Email" value={data.email} />
            <Field label="Telefon" value={data.phone} />
            <Field label="Website" value={data.website} />
            <Field label="Adresă" value={data.addressLine} />
            <Field label="Oraș" value={data.city} />
            <Field label="Județ" value={data.county} />
            <Field label="Cod poștal" value={data.postalCode} />
            <Field label="Țară" value={data.country} />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <Tabs defaultValue="timeline">
              <TabsList>
                <TabsTrigger value="timeline">Cronologie</TabsTrigger>
                <TabsTrigger value="notes">Note</TabsTrigger>
                <TabsTrigger value="deals">Deal-uri</TabsTrigger>
                <TabsTrigger value="tasks">Task-uri</TabsTrigger>
                <TabsTrigger value="reminders">Reminder-uri</TabsTrigger>
                <TabsTrigger value="attachments">Fișiere</TabsTrigger>
              </TabsList>
              <TabsContent value="timeline">
                <TimelineTab subjectType="COMPANY" subjectId={id} />
              </TabsContent>
              <TabsContent value="notes">
                <NotesTab subjectType="COMPANY" subjectId={id} />
              </TabsContent>
              <TabsContent value="deals">
                <DealsTab companyId={id} />
              </TabsContent>
              <TabsContent value="tasks">
                <TasksTab subjectType="COMPANY" subjectId={id} />
              </TabsContent>
              <TabsContent value="reminders">
                <RemindersTab subjectType="COMPANY" subjectId={id} />
              </TabsContent>
              <TabsContent value="attachments">
                <AttachmentsTab subjectType="COMPANY" subjectId={id} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }): JSX.Element {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value ?? '—'}</span>
    </div>
  );
}
