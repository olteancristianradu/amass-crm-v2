import { createRoute } from '@tanstack/react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { authedRoute } from './authed';
import { remindersApi } from '@/features/reminders/api';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reminder-urile mele</h1>
      {isLoading && <p className="text-sm text-muted-foreground">Se încarcă…</p>}
      <QueryError isError={isError} error={error} label="Nu am putut încărca remindere." />
      {data && data.data.length === 0 && (
        <p className="text-sm text-muted-foreground">Niciun reminder programat.</p>
      )}
      <div className="space-y-2">
        {data?.data.map((r) => (
          <Card key={r.id}>
            <CardContent className="flex items-center justify-between py-4">
              <div>
                <p className="font-medium">{r.title}</p>
                {r.body && <p className="text-sm text-muted-foreground">{r.body}</p>}
                <p className="mt-1 text-xs text-muted-foreground">
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
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
