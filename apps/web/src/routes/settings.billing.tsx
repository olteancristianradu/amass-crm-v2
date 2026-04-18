import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { authedRoute } from './authed';
import { billingApi, type SubscriptionStatus } from '@/features/billing/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CardSkeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';

export const settingsBillingRoute = createRoute({
  getParentRoute: () => authedRoute,
  path: '/settings/billing',
  component: SettingsBillingPage,
});

const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  TRIALING: 'Perioadă trial',
  ACTIVE: 'Activ',
  PAST_DUE: 'Plată restantă',
  CANCELED: 'Anulat',
  INCOMPLETE: 'Incomplet',
  PAUSED: 'Pauza',
};

const STATUS_COLORS: Record<SubscriptionStatus, string> = {
  TRIALING: 'bg-blue-100 text-blue-800',
  ACTIVE: 'bg-green-100 text-green-800',
  PAST_DUE: 'bg-red-100 text-red-800',
  CANCELED: 'bg-gray-200 text-gray-600',
  INCOMPLETE: 'bg-yellow-100 text-yellow-800',
  PAUSED: 'bg-orange-100 text-orange-800',
};

function SettingsBillingPage(): JSX.Element {
  const { data: sub, isLoading, isError, error } = useQuery({
    queryKey: ['billing', 'subscription'],
    queryFn: () => billingApi.getSubscription(),
  });

  const checkoutMut = useMutation({
    mutationFn: () => billingApi.createCheckout(),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
  });

  const portalMut = useMutation({
    mutationFn: () => billingApi.createPortal(),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
  });

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-2xl font-semibold">Facturare & Abonament</h1>

      {isLoading && <CardSkeleton />}
      {isError && (
        <p className="text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {sub && (
        <Card>
          <CardHeader>
            <CardTitle>Abonament curent</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                  Plan
                </p>
                <p className="font-semibold text-base capitalize">{sub.plan}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                  Status
                </p>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[sub.status]}`}
                >
                  {STATUS_LABELS[sub.status]}
                </span>
              </div>

              {sub.trialEndsAt && (
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                    Trial expiră
                  </p>
                  <p className="font-medium">
                    {new Date(sub.trialEndsAt).toLocaleDateString('ro-RO', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              )}

              {sub.currentPeriodEnd && (
                <div>
                  <p className="text-muted-foreground text-xs uppercase tracking-wide mb-1">
                    Perioadă curentă până la
                  </p>
                  <p className="font-medium">
                    {new Date(sub.currentPeriodEnd).toLocaleDateString('ro-RO', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                </div>
              )}

              {sub.cancelAtPeriodEnd && (
                <div className="col-span-2">
                  <p className="text-sm text-orange-600 font-medium">
                    Abonamentul se va anula la sfârșitul perioadei curente.
                  </p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-3 pt-2">
              {/* Show upgrade if on trial or on a free/lower plan */}
              {(sub.status === 'TRIALING' || sub.status === 'CANCELED') && (
                <Button
                  onClick={() => checkoutMut.mutate()}
                  disabled={checkoutMut.isPending}
                >
                  {checkoutMut.isPending ? 'Redirecționare…' : 'Upgrade plan'}
                </Button>
              )}

              {/* Show manage if there is an active Stripe subscription */}
              {sub.stripeSubscriptionId && (
                <Button
                  variant="outline"
                  onClick={() => portalMut.mutate()}
                  disabled={portalMut.isPending}
                >
                  {portalMut.isPending ? 'Redirecționare…' : 'Gestionează facturare'}
                </Button>
              )}
            </div>

            {(checkoutMut.isError || portalMut.isError) && (
              <p className="text-sm text-destructive">
                {(checkoutMut.error ?? portalMut.error) instanceof ApiError
                  ? ((checkoutMut.error ?? portalMut.error) as ApiError).message
                  : 'Eroare la redirecționare'}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* No subscription yet */}
      {!isLoading && !sub && !isError && (
        <Card>
          <CardContent className="py-8 flex flex-col items-center gap-4 text-center">
            <p className="text-muted-foreground">
              Nu există un abonament activ. Alege un plan pentru a continua.
            </p>
            <Button
              onClick={() => checkoutMut.mutate()}
              disabled={checkoutMut.isPending}
            >
              {checkoutMut.isPending ? 'Redirecționare…' : 'Alege un plan'}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
