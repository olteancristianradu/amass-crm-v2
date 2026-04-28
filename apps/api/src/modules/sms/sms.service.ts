import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { loadEnv } from '../../config/env';

export interface SendSmsDto {
  toNumber: string;
  body: string;
  contactId?: string;
}

@Injectable()
export class SmsService {
  constructor(private readonly prisma: PrismaService) {}

  async send(dto: SendSmsDto) {
    const env = loadEnv();
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_SMS_FROM) {
      throw new BadRequestException('Twilio SMS not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_SMS_FROM missing)');
    }

    const { tenantId } = requireTenantContext();

    // Create pending DB record first
    const sms = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.smsMessage.create({
        data: {
          tenantId,
          direction: 'OUTBOUND',
          fromNumber: env.TWILIO_SMS_FROM!,
          toNumber: dto.toNumber,
          body: dto.body,
          status: 'QUEUED',
          contactId: dto.contactId ?? null,
        },
      }),
    );

    // Send via Twilio REST API
    try {
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const twilioBase = (env.TWILIO_BASE_URL ?? 'https://api.twilio.com').replace(/\/$/, '');
      const url = `${twilioBase}/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ From: env.TWILIO_SMS_FROM!, To: dto.toNumber, Body: dto.body }),
      });
      const data = await res.json() as { sid?: string; status?: string; error_message?: string };

      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.smsMessage.update({
          where: { id: sms.id },
          data: {
            twilioSid: data.sid ?? null,
            status: res.ok ? 'SENT' : 'FAILED',
            error: data.error_message ?? null,
            sentAt: res.ok ? new Date() : null,
          },
        }),
      );

      return { id: sms.id, status: res.ok ? 'SENT' : 'FAILED', twilioSid: data.sid };
    } catch (err) {
      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.smsMessage.update({ where: { id: sms.id }, data: { status: 'FAILED', error: String(err) } }),
      );
      throw err;
    }
  }

  async handleInbound(tenantId: string, from: string, to: string, body: string, twilioSid: string) {
    // Try to match contact by phone number
    const contact = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.contact.findFirst({ where: { tenantId, phone: from, deletedAt: null }, select: { id: true } }),
    );

    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.smsMessage.upsert({
        where: { twilioSid },
        create: {
          tenantId,
          direction: 'INBOUND',
          fromNumber: from,
          toNumber: to,
          body,
          status: 'DELIVERED',
          twilioSid,
          contactId: contact?.id ?? null,
          sentAt: new Date(),
        },
        update: {},
      }),
    );
  }

  async listMessages(contactId?: string) {
    const { tenantId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.smsMessage.findMany({
        where: { tenantId, ...(contactId ? { contactId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    );
  }

  async getMessage(id: string) {
    const { tenantId } = requireTenantContext();
    const msg = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.smsMessage.findFirst({ where: { id, tenantId } }),
    );
    if (!msg) throw new NotFoundException('SMS not found');
    return msg;
  }
}
