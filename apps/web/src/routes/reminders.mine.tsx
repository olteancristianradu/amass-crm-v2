import { createRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { authedRoute } from './authed';
import { remindersApi } from '@/features/reminders/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { EmptyState, PageHeader } from '@/components/ui/page-header';
import { QueryError } from '@/components/ui/QueryError';

export const remindersMineRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/reminders',
  component: RemindersMinePage,
});

function RemindersMinePage(): JSX.Element {
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['reminders', 'mine'],
    queryFn: () => remindersApi.listMine(undefined, 50),
  });

  const dismiss = useMutation({
    mutationFn: (id: string) => remindersApi.dismiss(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders', 'mine'] }),
  });

  return (
    <div>
      <PageHeader
        title="Reminder-urile mele"
        subtitle="Memento-uri legate de companii, contacte, deal-uri sau task-uri."
      />

      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={isError} error={error} label="Nu am putut încărca remindere." />

      {data && data.data.length === 0 && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={Clock}
            title="Niciun reminder programat"
            description="Creează reminder-uri din pagina unui contact, companie sau deal — apar aici cu 1 oră înainte de scadență."
          />
        </GlassCard>
      )}

      <div className="space-y-2">
        {data?.data.map((r) => (
          <GlassCard key={r.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium leading-tight">{r.title}</p>
                {r.body && (
                  <p className="mt-1 text-sm text-muted-foreground">{r.body}</p>
                )}
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {new Date(r.remindAt).toLocaleString('ro-RO')} · {r.subjectType}
                </p>
              </div>
              {r.status === 'PENDING' && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => dismiss.mutate(r.id)}
                  disabled={dismiss.isPending}
                >
                  Închide
                </Button>
              )}
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
