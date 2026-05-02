import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, Link2, LogOut, Mail, RefreshCw } from 'lucide-react';
import { outlookApi } from '@/features/outlook/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';

export function OutlookConnect(): JSX.Element {
  const qc = useQueryClient();

  const { data: status, isLoading } = useQuery({
    queryKey: ['outlook-status'],
    queryFn: () => outlookApi.status(),
    staleTime: 60_000,
  });

  const disconnectMut = useMutation({
    mutationFn: () => outlookApi.disconnect(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['outlook-status'] }),
  });

  function handleConnect(): void {
    // Full page navigation to API endpoint which redirects to Microsoft
    window.location.href = outlookApi.getConnectUrl();
  }

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-xl bg-secondary/30" />;
  }

  return (
    <GlassCard className="p-5">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
          <Mail className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm">Microsoft Outlook</h3>
            {status?.connected && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                <CheckCircle className="h-3 w-3" />
                Conectat
              </span>
            )}
          </div>
          {status?.connected ? (
            <div className="mt-1 space-y-1">
              <p className="text-sm text-muted-foreground">
                {status.displayName && <span className="font-medium text-foreground">{status.displayName}</span>}
                {status.displayName && ' · '}
                {status.email}
              </p>
              <p className="text-xs text-muted-foreground">
                Poți trimite email-uri direct din CRM folosind acest cont Outlook.
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              Conectează contul Outlook pentru a trimite și citi email-uri direct din CRM fără configurare SMTP.
            </p>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {status?.connected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleConnect}
                title="Reconectează"
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Reconectează
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => disconnectMut.mutate()}
                disabled={disconnectMut.isPending}
                className="text-destructive hover:text-destructive"
              >
                <LogOut className="h-3.5 w-3.5 mr-1.5" />
                Deconectează
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={handleConnect}>
              <Link2 className="h-3.5 w-3.5 mr-1.5" />
              Conectează Outlook
            </Button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
