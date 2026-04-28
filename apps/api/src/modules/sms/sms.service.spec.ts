import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SmsService } from './sms.service';

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

vi.mock('../../config/env', () => ({
  loadEnv: () => ({
    TWILIO_ACCOUNT_SID: undefined,
    TWILIO_AUTH_TOKEN: undefined,
    TWILIO_SMS_FROM: undefined,
  }),
}));

describe('SmsService', () => {
  let svc: SmsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new SmsService(mockPrisma);
  });

  describe('send', () => {
    it('throws BadRequestException when Twilio is not configured', async () => {
      await expect(svc.send({ toNumber: '+40700000001', body: 'hello' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('handleInbound', () => {
    it('creates inbound SMS record, matching contact by phone', async () => {
      const contact = { id: 'contact-1' };
      const smsMsg = { id: 'sms-1', direction: 'INBOUND' };
      mockRunWithTenant
        .mockResolvedValueOnce(contact)  // findFirst contact by phone
        .mockResolvedValueOnce(smsMsg);  // upsert

      const result = await svc.handleInbound('tenant-1', '+40700000001', '+40700000002', 'Hello!', 'SM123');
      expect(result).toBe(smsMsg);
    });

    it('creates inbound SMS record without contact when no match', async () => {
      const smsMsg = { id: 'sms-2', direction: 'INBOUND' };
      mockRunWithTenant
        .mockResolvedValueOnce(null)    // no contact found
        .mockResolvedValueOnce(smsMsg); // upsert

      const result = await svc.handleInbound('tenant-1', '+40700000099', '+40700000002', 'Hi!', 'SM456');
      expect(result).toBe(smsMsg);
    });
  });

  describe('listMessages', () => {
    it('returns messages filtered by contactId when provided', async () => {
      const rows = [{ id: 'sms-1' }, { id: 'sms-2' }];
      mockRunWithTenant.mockResolvedValueOnce(rows);
      const out = await svc.listMessages('contact-7');
      expect(out).toBe(rows);
      const cb = mockRunWithTenant.mock.calls[0][1];
      // exec the callback against a stub to assert the where shape
      const tx = { smsMessage: { findMany: vi.fn().mockResolvedValue(rows) } };
      await cb(tx);
      expect(tx.smsMessage.findMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ contactId: 'contact-7' }),
      }));
    });

    it('returns ALL tenant messages when contactId is omitted', async () => {
      mockRunWithTenant.mockResolvedValueOnce([]);
      await svc.listMessages();
      const cb = mockRunWithTenant.mock.calls[0][1];
      const tx = { smsMessage: { findMany: vi.fn().mockResolvedValue([]) } };
      await cb(tx);
      const args = tx.smsMessage.findMany.mock.calls[0][0];
      expect(args.where.contactId).toBeUndefined();
    });
  });

  describe('getMessage', () => {
    it('returns the message row when found', async () => {
      const row = { id: 'sms-1', body: 'hi' };
      mockRunWithTenant.mockResolvedValueOnce(row);
      const out = await svc.getMessage('sms-1');
      expect(out).toBe(row);
    });

    it('throws NotFound when message not found', async () => {
      mockRunWithTenant.mockResolvedValueOnce(null);
      const { NotFoundException } = await import('@nestjs/common');
      await expect(svc.getMessage('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
