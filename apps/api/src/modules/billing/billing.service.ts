/**
 * Stripe billing integration.
 * S51 — subscription plans + Stripe Checkout + webhook sync.
 */
import { BadRequestException, Injectable, Logger, RawBodyRequest } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { loadEnv } from '../../config/env';
import { getBreaker } from '../../common/resilience/circuit-breaker';
import { extractSubscriptionPatch, StripeSubscriptionShape } from './billing.helpers';
import type { Request } from 'express';

// Lazy-load Stripe — avoids startup failures when STRIPE_SECRET_KEY is not set
// eslint-disable-next-line @typescript-eslint/no-require-imports
const StripeLib = require('stripe') as { new(key: string, opts: Record<string, unknown>): StripeInstanceType };

interface StripeInstanceType {
  customers: { create(params: Record<string, unknown>): Promise<{ id: string }> };
  checkout: { sessions: { create(params: Record<string, unknown>): Promise<{ url: string }> } };
  billingPortal: { sessions: { create(params: Record<string, unknown>): Promise<{ url: string }> } };
  webhooks: { constructEvent(payload: Buffer | string, sig: string, secret: string): unknown };
  subscriptions: Record<string, unknown>;
}

type StripeInstance = StripeInstanceType;

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private stripe: StripeInstance | null = null;

  constructor(private readonly prisma: PrismaService) {
    const env = loadEnv();
    if (env.STRIPE_SECRET_KEY) {
      this.stripe = new StripeLib(env.STRIPE_SECRET_KEY, { apiVersion: '2026-03-25.dahlia' });
    }
  }

  private get client(): StripeInstance {
    if (!this.stripe) throw new BadRequestException('Stripe not configured (STRIPE_SECRET_KEY missing)');
    return this.stripe;
  }

  async getSubscription() {
    const { tenantId } = requireTenantContext();
    const sub = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.billingSubscription.findFirst({ where: { tenantId } }),
    );
    if (!sub) {
      return this.prisma.runWithTenant(tenantId, (tx) =>
        tx.billingSubscription.create({
          data: {
            tenantId,
            plan: 'starter',
            status: 'TRIALING',
            trialEndsAt: new Date(Date.now() + 14 * 86400_000),
          },
        }),
      );
    }
    return sub;
  }

  async createCheckoutSession(plan: string, successUrl: string, cancelUrl: string): Promise<{ url: string }> {
    const { tenantId } = requireTenantContext();
    const sub = await this.getSubscription();

    const PRICE_IDS: Record<string, string> = {
      starter: process.env['STRIPE_PRICE_STARTER'] ?? '',
      growth: process.env['STRIPE_PRICE_GROWTH'] ?? '',
      enterprise: process.env['STRIPE_PRICE_ENTERPRISE'] ?? '',
    };

    const priceId = PRICE_IDS[plan];
    if (!priceId) throw new BadRequestException(`Unknown plan: ${plan}`);

    // C-ops: wrap every outbound Stripe REST call in a shared breaker so a
    // Stripe outage doesn't chain-fail every checkout attempt.
    const client = this.client;
    const breaker = getBreaker('stripe');
    let customerId = sub.stripeCustomerId ?? undefined;
    if (!customerId) {
      const customer = await breaker.exec(() => client.customers.create({ metadata: { tenantId } }));
      customerId = customer.id;
      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.billingSubscription.update({ where: { tenantId }, data: { stripeCustomerId: customerId } }),
      );
    }

    const session = await breaker.exec(() =>
      client.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { tenantId },
      }),
    );

    return { url: session.url! };
  }

  async createBillingPortalSession(returnUrl: string): Promise<{ url: string }> {
    const sub = await this.getSubscription();
    if (!sub.stripeCustomerId) throw new BadRequestException('No Stripe customer linked');
    const client = this.client;
    const session = await getBreaker('stripe').exec(() =>
      client.billingPortal.sessions.create({
        customer: sub.stripeCustomerId!,
        return_url: returnUrl,
      }),
    );
    return { url: session.url };
  }

  async handleWebhook(req: RawBodyRequest<Request>): Promise<void> {
    const env = loadEnv();
    if (!env.STRIPE_WEBHOOK_SECRET) throw new BadRequestException('STRIPE_WEBHOOK_SECRET not configured');

    const sig = req.headers['stripe-signature'] as string;
    let event: { type: string; data: { object: unknown } };

    try {
      event = this.client.webhooks.constructEvent(req.rawBody!, sig, env.STRIPE_WEBHOOK_SECRET) as typeof event;
    } catch (err) {
      throw new BadRequestException(`Webhook signature invalid: ${String(err)}`);
    }

    await this.processStripeEvent(event);
  }

  async processStripeEvent(event: { type: string; data: { object: unknown } }): Promise<void> {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as StripeSubscriptionShape;
        const tenantId = stripeSub.metadata?.['tenantId'];
        if (!tenantId) return;
        const patch = extractSubscriptionPatch(stripeSub);
        await this.prisma.runWithTenant(tenantId, (tx) =>
          tx.billingSubscription.upsert({
            where: { tenantId },
            create: { tenantId, ...patch },
            update: {
              stripeSubscriptionId: patch.stripeSubscriptionId,
              plan: patch.plan,
              status: patch.status,
              currentPeriodStart: patch.currentPeriodStart,
              currentPeriodEnd: patch.currentPeriodEnd,
              cancelAtPeriodEnd: patch.cancelAtPeriodEnd,
            },
          }),
        );
        break;
      }
      case 'customer.subscription.deleted': {
        const stripeSub = event.data.object as StripeSubscriptionShape;
        const tenantId = stripeSub.metadata?.['tenantId'];
        if (!tenantId) return;
        await this.prisma.runWithTenant(tenantId, (tx) =>
          tx.billingSubscription.update({ where: { tenantId }, data: { status: 'CANCELED' } }),
        );
        break;
      }
      default:
        this.logger.debug(`Unhandled Stripe event: ${event.type}`);
    }
  }
}
