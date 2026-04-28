import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { SubjectType, WhatsappMessageDirection, WhatsappMessageStatus } from '@prisma/client';
import { CreateWhatsappAccountDto, SendWhatsappMessageDto } from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { decrypt as decryptSecret, encrypt as encryptSecret } from '../../common/crypto/encryption';
import { loadEnv } from '../../config/env';

const META_API_VERSION = 'v19.0';
function metaBase(): string {
  // Allow overriding the Meta Graph host via env (apps/mock-services in
  // dev). Keep the version segment in the path so the mock can match
  // the same /v19.0/:phoneId/messages shape the production Cloud API
  // accepts.
  const override = loadEnv().META_GRAPH_BASE_URL;
  return `${(override ?? 'https://graph.facebook.com').replace(/\/$/, '')}/${META_API_VERSION}`;
}

@Injectable()
export class WhatsappService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activities: ActivitiesService,
  ) {}

  // ─── Account management ────────────────────────────────────────────────────

  async createAccount(dto: CreateWhatsappAccountDto) {
    const { tenantId } = requireTenantContext();
    // AES-256-GCM at rest. The field was previously stored as base64 which
    // is an encoding, not encryption — a DB dump leaked live Meta access
    // tokens usable to send WhatsApp messages + read webhooks.
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.whatsappAccount.create({
        data: {
          tenantId,
          phoneNumberId: dto.phoneNumberId,
          displayPhoneNumber: dto.displayPhoneNumber,
          accessTokenEnc: encryptSecret(dto.accessToken),
          webhookVerifyToken: dto.webhookVerifyToken,
        },
      }),
    );
  }

  async listAccounts() {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.whatsappAccount.findMany({
        where: { tenantId, deletedAt: null, isActive: true },
        select: { id: true, displayPhoneNumber: true, phoneNumberId: true, isActive: true, createdAt: true },
      }),
    );
  }

  async removeAccount(id: string) {
    const { tenantId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.whatsappAccount.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } }),
    );
  }

  // ─── Send message ──────────────────────────────────────────────────────────

  async send(dto: SendWhatsappMessageDto) {
    const { tenantId } = requireTenantContext();
    const account = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.whatsappAccount.findFirst({ where: { tenantId, isActive: true, deletedAt: null } }),
    );
    if (!account) throw new NotFoundException('No active WhatsApp account configured');
    if (!dto.body) throw new BadRequestException('Message body is required');

    const accessToken = decryptSecret(account.accessTokenEnc);

    const payload = {
      messaging_product: 'whatsapp',
      to: dto.toNumber.replace(/\D/g, ''),
      type: 'text',
      text: { body: dto.body },
    };

    const response = await fetch(`${metaBase()}/${account.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json() as { messages?: { id: string }[] };
    if (!response.ok) {
      throw new BadRequestException(`WhatsApp API error: ${JSON.stringify(data)}`);
    }

    const externalId = data.messages?.[0]?.id;
    const msg = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.whatsappMessage.create({
        data: {
          tenantId,
          accountId: account.id,
          subjectType: dto.subjectType as SubjectType,
          subjectId: dto.subjectId,
          direction: WhatsappMessageDirection.OUTBOUND,
          status: WhatsappMessageStatus.SENT,
          fromNumber: account.displayPhoneNumber,
          toNumber: dto.toNumber,
          body: dto.body,
          externalId: externalId ?? null,
          sentAt: new Date(),
        },
      }),
    );

    await this.activities.log({
      subjectType: dto.subjectType as SubjectType,
      subjectId: dto.subjectId,
      action: 'whatsapp.sent',
      metadata: { messageId: msg.id, to: dto.toNumber },
    });

    return msg;
  }

  // ─── Webhook ───────────────────────────────────────────────────────────────

  verifyWebhook(verifyToken: string, challenge: string, tenantVerifyToken: string): string {
    if (verifyToken !== tenantVerifyToken) throw new UnauthorizedException('Invalid verify token');
    return challenge;
  }

  async handleWebhook(tenantId: string, body: unknown, signature: string): Promise<void> {
    const account = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.whatsappAccount.findFirst({
        where: { tenantId, isActive: true, deletedAt: null },
      }),
    );
    if (!account) return;

    // HMAC secret for inbound-webhook verification is `webhookVerifyToken`,
    // which is a Meta-provided secret distinct from the access token used
    // for outbound API calls. Reusing accessToken was an anti-pattern —
    // a leaked access token should not also let an attacker forge inbound
    // webhooks. See https://developers.facebook.com/docs/graph-api/webhooks
    const expected = `sha256=${createHmac('sha256', account.webhookVerifyToken)
      .update(JSON.stringify(body))
      .digest('hex')}`;
    // timingSafeEqual to prevent timing oracles on the signature check.
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      throw new UnauthorizedException('Invalid HMAC signature');
    }

    const parsed = body as {
      entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ id: string; from: string; text?: { body: string }; timestamp: string }> } }> }>
    };
    const messages = parsed.entry?.[0]?.changes?.[0]?.value?.messages ?? [];

    for (const m of messages) {
      // externalId is globally-unique (Meta-assigned) so findUnique
      // without tenant filter is by-design — the subsequent create runs
      // inside runWithTenant so the row inherits the correct tenantId.
      const existing = await this.prisma.whatsappMessage.findUnique({ where: { externalId: m.id } });
      if (existing) continue;

      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.whatsappMessage.create({
          data: {
            tenantId,
            accountId: account.id,
            subjectType: SubjectType.CLIENT,
            subjectId: m.from,
            direction: WhatsappMessageDirection.INBOUND,
            status: WhatsappMessageStatus.DELIVERED,
            fromNumber: m.from,
            toNumber: account.displayPhoneNumber,
            body: m.text?.body ?? null,
            externalId: m.id,
            sentAt: new Date(Number(m.timestamp) * 1000),
          },
        }),
      );
    }
  }

  async listMessages(subjectType: string, subjectId: string) {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.whatsappMessage.findMany({
        where: { tenantId, subjectType: subjectType as SubjectType, subjectId },
        orderBy: { createdAt: 'asc' },
        take: 200,
      }),
    );
  }

  /** Called by Meta status webhook to update delivery/read status. */
  async updateStatus(externalId: string, status: string): Promise<void> {
    const statusMap: Record<string, WhatsappMessageStatus> = {
      delivered: WhatsappMessageStatus.DELIVERED,
      read: WhatsappMessageStatus.READ,
      failed: WhatsappMessageStatus.FAILED,
    };
    const mapped = statusMap[status];
    if (!mapped) return;
    await this.prisma.whatsappMessage.updateMany({
      where: { externalId },
      data: {
        status: mapped,
        ...(mapped === WhatsappMessageStatus.DELIVERED ? { deliveredAt: new Date() } : {}),
        ...(mapped === WhatsappMessageStatus.READ ? { readAt: new Date() } : {}),
      },
    });
  }
}
