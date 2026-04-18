/**
 * Outbound webhooks — tenants register HTTPS endpoints to receive CRM events.
 * On each event, WebhooksService.dispatch() POSTs a signed JSON payload to all
 * matching active endpoints. Deliveries are logged for debugging.
 *
 * Signature: X-Amass-Signature: sha256=<hmac-hex>  (same scheme as GitHub webhooks)
 */
import { createHmac, randomBytes } from 'crypto';
import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, WebhookEvent } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

export interface CreateWebhookEndpointDto {
  url: string;
  events: WebhookEvent[];
}

export interface UpdateWebhookEndpointDto {
  url?: string;
  events?: WebhookEvent[];
  isActive?: boolean;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWebhookEndpointDto) {
    const { tenantId } = requireTenantContext();
    const secret = randomBytes(24).toString('hex');

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.create({
        data: { tenantId, url: dto.url, secret, events: { set: dto.events } },
        select: { id: true, url: true, events: true, isActive: true, createdAt: true, secret: true },
      }),
    );
  }

  async list() {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.findMany({
        where: { tenantId },
        select: { id: true, url: true, events: true, isActive: true, createdAt: true },
      }),
    );
  }

  async get(id: string) {
    const { tenantId } = requireTenantContext();
    const ep = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.findFirst({ where: { id, tenantId } }),
    );
    if (!ep) throw new NotFoundException('Webhook endpoint not found');
    return ep;
  }

  async update(id: string, dto: UpdateWebhookEndpointDto) {
    await this.get(id);
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.update({
        where: { id },
        data: {
          ...(dto.url !== undefined ? { url: dto.url } : {}),
          ...(dto.events !== undefined ? { events: { set: dto.events } } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      }),
    );
  }

  async delete(id: string) {
    const { tenantId } = requireTenantContext();
    await this.get(id);
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.delete({ where: { id } }),
    );
  }

  async listDeliveries(endpointId: string) {
    await this.get(endpointId);
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookDelivery.findMany({
        where: { endpointId },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  /** Dispatch event to all active matching endpoints for a tenant. Fire-and-forget. */
  dispatch(tenantId: string, event: WebhookEvent, payload: Record<string, unknown>): void {
    this.sendToEndpoints(tenantId, event, payload).catch((err) =>
      this.logger.error(`Webhook dispatch error: ${String(err)}`),
    );
  }

  private async sendToEndpoints(tenantId: string, event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
    const endpoints = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.findMany({
        where: { tenantId, isActive: true, events: { has: event } },
      }),
    );

    const body = JSON.stringify({ event, tenantId, timestamp: new Date().toISOString(), data: payload });

    await Promise.allSettled(endpoints.map((ep) => this.deliver(ep, event, body, payload)));
  }

  private async deliver(
    ep: { id: string; url: string; secret: string },
    event: WebhookEvent,
    body: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sig = `sha256=${createHmac('sha256', ep.secret).update(body).digest('hex')}`;

    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Amass-Signature': sig, 'X-Amass-Event': event },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      statusCode = res.status;
      responseBody = (await res.text()).slice(0, 2000);
      success = res.ok;
    } catch (err) {
      responseBody = String(err).slice(0, 2000);
    }

    await this.prisma.webhookDelivery.create({
      data: {
        endpointId: ep.id,
        event,
        payload: payload as Prisma.InputJsonObject,
        statusCode,
        responseBody,
        success,
      },
    });

    if (!success) this.logger.warn(`Webhook delivery failed for endpoint ${ep.id}: ${statusCode}`);
  }

  private async validateUrl(url: string): Promise<void> {
    try { new URL(url); } catch { throw new BadRequestException('Invalid webhook URL'); }
    if (!url.startsWith('https://') && process.env['NODE_ENV'] === 'production') {
      throw new BadRequestException('Webhook URL must use HTTPS in production');
    }
  }
}
