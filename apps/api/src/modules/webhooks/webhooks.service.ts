/**
 * Outbound webhooks — tenants register HTTPS endpoints to receive CRM events.
 * On each event, WebhooksService.dispatch() POSTs a signed JSON payload to all
 * matching active endpoints. Deliveries are logged for debugging.
 *
 * Signature: X-Amass-Signature: sha256=<hmac-hex>  (same scheme as GitHub webhooks)
 */
import { createHmac, randomBytes } from 'node:crypto';
import { request as httpRequest, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup } from 'dns/promises';
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

const PUBLIC_ENDPOINT_SELECT = {
  id: true,
  url: true,
  events: true,
  isActive: true,
  createdAt: true,
} as const;

interface ValidatedWebhookUrl {
  parsed: URL;
  pinnedAddress?: { address: string; family: number };
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateWebhookEndpointDto) {
    await this.validateUrl(dto.url);
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
      tx.webhookEndpoint.findFirst({
        where: { id, tenantId },
        select: PUBLIC_ENDPOINT_SELECT,
      }),
    );
    if (!ep) throw new NotFoundException('Webhook endpoint not found');
    return ep;
  }

  async update(id: string, dto: UpdateWebhookEndpointDto) {
    await this.get(id);
    if (dto.url !== undefined) await this.validateUrl(dto.url);
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.webhookEndpoint.update({
        where: { id },
        data: {
          ...(dto.url !== undefined ? { url: dto.url } : {}),
          ...(dto.events !== undefined ? { events: { set: dto.events } } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
        select: PUBLIC_ENDPOINT_SELECT,
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

    await Promise.allSettled(endpoints.map((ep) => this.deliver(ep, event, body, payload, tenantId)));
  }

  private async deliver(
    ep: { id: string; url: string; secret: string },
    event: WebhookEvent,
    body: string,
    payload: Record<string, unknown>,
    tenantId: string,
  ): Promise<void> {
    const sig = `sha256=${createHmac('sha256', ep.secret).update(body).digest('hex')}`;

    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      // Re-validate at delivery time to defeat DNS rebinding: attacker registers
      // an endpoint whose DNS resolves to a public IP at creation, but flips to
      // 127.0.0.1 before the webhook fires.
      const target = await this.validateUrl(ep.url);
      const res = await this.postJson(target, {
        'Content-Type': 'application/json',
        'X-Amass-Signature': sig,
        'X-Amass-Event': event,
      }, body);
      statusCode = res.status;
      responseBody = res.text.slice(0, 2000);
      success = res.ok;
    } catch (err) {
      responseBody = String(err).slice(0, 2000);
    }

    await this.prisma.webhookDelivery.create({
      data: {
        tenantId,
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

  /**
   * SSRF defense. Called on create/update AND again at delivery time
   * (DNS rebinding defense — the IP seen at registration can flip).
   *
   * Rules:
   *   - HTTPS in production (HTTP allowed only in dev/test).
   *   - No userinfo ("user:pass@host") — prevents some bypass tricks.
   *   - Host must resolve to a PUBLIC IP. Private / loopback / link-local /
   *     reserved / cloud-metadata ranges are rejected on ALL resolved IPs.
   */
  private async validateUrl(url: string): Promise<ValidatedWebhookUrl> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new BadRequestException('Invalid webhook URL'); }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BadRequestException('Webhook URL must use http(s)');
    }
    if (parsed.protocol === 'http:' && process.env['NODE_ENV'] === 'production') {
      throw new BadRequestException('Webhook URL must use HTTPS in production');
    }
    if (parsed.username || parsed.password) {
      throw new BadRequestException('Webhook URL must not contain credentials');
    }

    // In test env, skip DNS lookups — tests use fake hostnames.
    if (process.env['NODE_ENV'] === 'test') return { parsed };

    // Dev escape hatch: comma-separated allow-list of hostnames whose
    // private/loopback resolution is acceptable. Use ONLY for the local
    // mock-services container (`webhook-mock` etc.) — empty in prod.
    const trusted = (process.env['WEBHOOK_TRUSTED_HOSTS'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (trusted.includes(parsed.hostname)) return { parsed };

    let records: Array<{ address: string; family: number }>;
    try {
      records = await lookup(parsed.hostname, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException('Webhook URL host cannot be resolved');
    }

    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address, rec.family)) {
        throw new BadRequestException('Webhook URL must resolve to a public address');
      }
    }

    return { parsed, pinnedAddress: records[0] };
  }

  private async postJson(
    target: ValidatedWebhookUrl,
    headers: Record<string, string>,
    body: string,
  ): Promise<{ status: number; ok: boolean; text: string }> {
    if (!target.pinnedAddress) {
      const res = await fetch(target.parsed.toString(), {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      return { status: res.status, ok: res.ok, text: await res.text() };
    }

    const pinnedAddress = target.pinnedAddress;
    return new Promise((resolve, reject) => {
      const isHttps = target.parsed.protocol === 'https:';
      const requestFn = isHttps ? httpsRequest : httpRequest;
      const options: RequestOptions & { servername?: string } = {
        protocol: target.parsed.protocol,
        hostname: pinnedAddress.address,
        port: Number(target.parsed.port) || (isHttps ? 443 : 80),
        method: 'POST',
        path: `${target.parsed.pathname}${target.parsed.search}`,
        headers: {
          ...headers,
          Host: target.parsed.host,
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 10_000,
      };
      if (isHttps) options.servername = target.parsed.hostname;

      const req = requestFn(options, (res) => {
        const chunks: Buffer[] = [];
        let captured = 0;
        res.on('data', (chunk: Buffer | string) => {
          if (captured >= 2000) return;
          const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          const remaining = 2000 - captured;
          chunks.push(buf.subarray(0, remaining));
          captured += Math.min(buf.length, remaining);
        });
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            text: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });

      req.on('timeout', () => req.destroy(new Error('Webhook request timed out')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}

/**
 * Returns true if the IP is in a non-routable / metadata-sensitive range.
 * Covers IPv4 and IPv6. Blocks: loopback, link-local, private RFC1918,
 * carrier-grade NAT, AWS/GCP metadata (169.254.169.254), ULA, ::1, etc.
 */
export function isPrivateOrReservedIp(ip: string, family: number): boolean {
  if (family === 4) {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
    const [a, b] = parts;
    if (a === 0) return true;                          // 0.0.0.0/8
    if (a === 10) return true;                         // 10.0.0.0/8 private
    if (a === 127) return true;                        // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true;           // 169.254.0.0/16 link-local + AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true;  // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true;           // 192.168.0.0/16 private
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true;                         // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  const firstByte = parseInt(lower.split(':')[0] || '0', 16);
  if ((firstByte & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((firstByte & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // IPv4-mapped (::ffff:a.b.c.d) — re-check as v4
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    if (v4.includes('.')) return isPrivateOrReservedIp(v4, 4);
  }
  return false;
}
