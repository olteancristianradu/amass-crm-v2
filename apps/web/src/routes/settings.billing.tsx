import { createRoute } from '@tanstack/react-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { authedRoute } from './authed';
import { billingApi, type SubscriptionStatus } from '@/features/billing/api';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import {
  EmptyState,
  PageHeader,
  StatusBadge,
  type StatusBadgeTone,
} from '@/components/ui/page-header';
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

const STATUS_TONES: Record<SubscriptionStatus, StatusBadgeTone> = {
  TRIALING: 'blue',
  ACTIVE: 'green',
  PAST_DUE: 'pink',
  CANCELED: 'neutral',
  INCOMPLETE: 'amber',
  PAUSED: 'amber',
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
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Facturare & abonament"
        subtitle="Plan curent, perioada de trial, și gestionarea metodelor de plată via Stripe."
      />

      {isLoading && <CardSkeleton />}
      {isError && (
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          Eroare: {error instanceof ApiError ? error.message : 'necunoscută'}
        </p>
      )}

      {sub && (
        <GlassCard className="p-6">
          <header className="mb-5 flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-full bg-secondary text-foreground">
              <CreditCard size={18} />
            </span>
            <div>
              <h2 className="font-medium leading-tight">Abonament curent</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Plan + status sincronizat cu Stripe
              </p>
            </div>
          </header>

          <dl className="grid grid-cols-2 gap-y-4 text-sm">
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Plan
              </dt>
              <dd className="mt-1 text-base font-semibold capitalize">{sub.plan}</dd>
            </div>
            <div>
              <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Status
              </dt>
              <dd className="mt-1">
                <StatusBadge tone={STATUS_TONES[sub.status]}>{STATUS_LABELS[sub.status]}</StatusBadge>
              </dd>
            </div>

            {sub.trialEndsAt && (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Trial expiră
                </dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {new Date(sub.trialEndsAt).toLocaleDateString('ro-RO', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </dd>
              </div>
            )}

            {sub.currentPeriodEnd && (
              <div>
                <dt className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Perioadă curentă până la
                </dt>
                <dd className="mt-1 font-medium tabular-nums">
                  {new Date(sub.currentPeriodEnd).toLocaleDateString('ro-RO', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                  })}
                </dd>
              </div>
            )}
          </dl>

          {sub.cancelAtPeriodEnd && (
            <p className="mt-4 rounded-md border border-accent-amber/30 bg-accent-amber/[0.06] px-3 py-2 text-sm text-accent-amber">
              Abonamentul se va anula la sfârșitul perioadei curente.
            </p>
          )}

          <div className="mt-6 flex flex-wrap gap-2 border-t border-border/40 pt-5">
            {(sub.status === 'TRIALING' || sub.status === 'CANCELED') && (
              <Button onClick={() => checkoutMut.mutate()} disabled={checkoutMut.isPending}>
                {checkoutMut.isPending ? 'Redirecționare…' : 'Upgrade plan'}
              </Button>
            )}
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
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {(checkoutMut.error ?? portalMut.error) instanceof ApiError
                ? ((checkoutMut.error ?? portalMut.error) as ApiError).message
                : 'Eroare la redirecționare'}
            </p>
          )}
        </GlassCard>
      )}

      {!isLoading && !sub && !isError && (
        <GlassCard className="overflow-hidden">
          <EmptyState
            icon={CreditCard}
            title="Niciun abonament activ"
            description="Alege un plan pentru a continua. Plata se procesează prin Stripe Checkout."
            action={
              <Button onClick={() => checkoutMut.mutate()} disabled={checkoutMut.isPending}>
                {checkoutMut.isPending ? 'Redirecționare…' : 'Alege un plan'}
              </Button>
            }
          />
        </GlassCard>
      )}
    </div>
  );
}
