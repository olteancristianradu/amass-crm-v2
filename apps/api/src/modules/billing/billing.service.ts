/**
 * Stripe billing integration.
 * S51 — subscription plans + Stripe Checkout + webhook sync.
 */
import { BadRequestException, Injectable, Logger, RawBodyRequest } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
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

  async processStripeEvent(event: { id?: string; type: string; data: { object: unknown } }): Promise<void> {
    // Idempotency: Stripe retries webhooks on any 5xx, and a network blip
    // during our own DB write can result in a retry for an event we've
    // already processed. Gate on event.id with SETNX TTL 24h so the same
    // event is a no-op on re-delivery.
    if (event.id) {
      const key = `stripe:event:${event.id}`;
      const acquired = await this.redis.client.set(key, '1', 'EX', 86_400, 'NX');
      if (acquired !== 'OK') {
        this.logger.debug(`Stripe event ${event.id} already processed, skipping`);
        return;
      }
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const stripeSub = event.data.object as StripeSubscriptionShape;
        const tenantId = await this.resolveTenantForStripeSub(stripeSub);
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
        const tenantId = await this.resolveTenantForStripeSub(stripeSub);
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

  /**
   * Derive the tenantId for an incoming Stripe subscription object.
   *
   * SECURITY: previously we read `stripeSub.metadata.tenantId` directly —
   * that field is mutable by anyone with the Stripe API key. A leaked key
   * could be used to set metadata.tenantId = <victim tenant> and corrupt
   * the victim's subscription via our webhook.
   *
   * The source of truth is our DB: look up which tenant owns the Stripe
   * customer id (stripeCustomerId is on the BillingSubscription row we
   * created at checkout). Metadata is accepted only as a fallback when
   * we haven't seen the customer yet (e.g. newly-created subscription in
   * a migration scenario) — and even then we cross-check against our DB.
   */
  private async resolveTenantForStripeSub(sub: StripeSubscriptionShape): Promise<string | null> {
    const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
    const byCustomer = await this.prisma.billingSubscription.findFirst({
      where: { stripeCustomerId: customerId },
      select: { tenantId: true },
    });
    if (byCustomer) return byCustomer.tenantId;

    const claimed = sub.metadata?.['tenantId'];
    if (!claimed) return null;
    // Fallback: ensure the claimed tenant actually exists and has no
    // other subscription wired to a different Stripe customer.
    const existing = await this.prisma.billingSubscription.findUnique({
      where: { tenantId: claimed },
      select: { stripeCustomerId: true },
    });
    if (existing?.stripeCustomerId && existing.stripeCustomerId !== customerId) {
      this.logger.warn(
        `Stripe metadata tenantId=${claimed} does not match existing customer ${existing.stripeCustomerId} — refusing`,
      );
      return null;
    }
    return claimed;
  }
}
