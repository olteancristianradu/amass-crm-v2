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
});
