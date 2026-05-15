import { describe, expect, it, vi } from 'vitest';
import { BillingController } from './billing.controller';
import type { BillingService } from './billing.service';

/**
 * Controller is a thin pass-through: every endpoint delegates to BillingService
 * after auth/role/policy guards (covered by integration tests). These specs
 * pin the wiring (which DTO field maps to which service argument) without
 * standing up Nest's DI container.
 */

function makeSvc() {
  return {
    getSubscription: vi.fn(),
    createCheckoutSession: vi.fn(),
    createBillingPortalSession: vi.fn(),
    handleWebhook: vi.fn(),
  } as unknown as BillingService & {
    getSubscription: ReturnType<typeof vi.fn>;
    createCheckoutSession: ReturnType<typeof vi.fn>;
    createBillingPortalSession: ReturnType<typeof vi.fn>;
    handleWebhook: ReturnType<typeof vi.fn>;
  };
}

describe('BillingController', () => {
  it('GET /billing/subscription delegates to BillingService.getSubscription', async () => {
    const svc = makeSvc();
    svc.getSubscription.mockResolvedValue({ plan: 'starter', status: 'TRIALING' });
    const ctrl = new BillingController(svc);

    await ctrl.getSubscription();
    expect(svc.getSubscription).toHaveBeenCalledOnce();
  });

  it('POST /billing/checkout forwards plan + URLs to createCheckoutSession', async () => {
    const svc = makeSvc();
    svc.createCheckoutSession.mockResolvedValue({ url: 'https://checkout.stripe.com/abc' });
    const ctrl = new BillingController(svc);

    const dto = { plan: 'growth', successUrl: 'https://app/ok', cancelUrl: 'https://app/cancel' };
    const r = await ctrl.checkout(dto);
    expect(svc.createCheckoutSession).toHaveBeenCalledWith('growth', 'https://app/ok', 'https://app/cancel');
    expect(r).toEqual({ url: 'https://checkout.stripe.com/abc' });
  });

  it('POST /billing/portal forwards returnUrl to createBillingPortalSession', async () => {
    const svc = makeSvc();
    svc.createBillingPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/p_1' });
    const ctrl = new BillingController(svc);

    const r = await ctrl.portal({ returnUrl: 'https://app/return' });
    expect(svc.createBillingPortalSession).toHaveBeenCalledWith('https://app/return');
    expect(r).toEqual({ url: 'https://billing.stripe.com/p_1' });
  });

  it('POST /billing/webhook forwards the raw request to handleWebhook', async () => {
    const svc = makeSvc();
    svc.handleWebhook.mockResolvedValue(undefined);
    const ctrl = new BillingController(svc);

    const req = { headers: { 'stripe-signature': 't=1,v1=sig' }, rawBody: Buffer.from('{}') } as never;
    await ctrl.webhook(req);
    expect(svc.handleWebhook).toHaveBeenCalledWith(req);
  });
});
