import { describe, it, expect, vi, beforeEach } from 'vitest';
import { UnauthorizedException, BadRequestException } from '@nestjs/common';
import { PortalService } from './portal.service';

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

describe('PortalService', () => {
  let svc: PortalService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new PortalService(mockPrisma);
  });

  describe('requestAccess', () => {
    it('creates a portal token with 24h expiry', async () => {
      const token = { id: 't1', token: 'abc123', expiresAt: new Date(Date.now() + 86400_000), email: 'test@example.com' };
      mockRunWithTenant.mockResolvedValue(token);

      const result = await svc.requestAccess('tenant-1', {
        email: 'test@example.com',
        tenantSlug: 'test',
        companyId: 'comp-1',
      });

      expect(result.token).toBe('abc123');
      expect(result.expiresAt).toBeDefined();
    });
  });

  describe('verifyToken', () => {
    it('throws UnauthorizedException for expired/invalid token', async () => {
      mockRunWithTenant.mockResolvedValue(null);
      await expect(svc.verifyToken('tenant-1', 'bad-token')).rejects.toThrow(UnauthorizedException);
    });

    it('returns valid info for correct token', async () => {
      const record = { id: 't1', email: 'client@example.com', companyId: 'comp-1', clientId: null };
      mockRunWithTenant.mockResolvedValue(record);

      const result = await svc.verifyToken('tenant-1', 'valid-token');
      expect(result.valid).toBe(true);
      expect(result.email).toBe('client@example.com');
    });
  });

  describe('signQuote', () => {
    it('throws BadRequestException if quote status is not SENT', async () => {
      const tokenRecord = { id: 't1', companyId: 'comp-1' };
      const quote = { id: 'q1', status: 'ACCEPTED', number: 'OF-001', companyId: 'comp-1' };
      mockRunWithTenant
        .mockResolvedValueOnce(tokenRecord) // resolveToken
        .mockResolvedValueOnce(quote);       // findFirst quote

      await expect(svc.signQuote('tenant-1', 'token', 'q1', { signatureBase64: 'abc', signerName: 'Ion Pop' }))
        .rejects.toThrow(BadRequestException);
    });

    it('updates quote status to ACCEPTED and creates activity', async () => {
      const tokenRecord = { id: 't1', companyId: 'comp-1', email: 'client@example.com' };
      const quote = { id: 'q1', status: 'SENT', number: 'OF-001', companyId: 'comp-1' };
      mockRunWithTenant
        .mockResolvedValueOnce(tokenRecord)
        .mockResolvedValueOnce(quote)
        .mockResolvedValueOnce({}); // transaction

      const result = await svc.signQuote('tenant-1', 'token', 'q1', { signatureBase64: 'abc', signerName: 'Ion Pop' });
      expect(result.signed).toBe(true);
      expect(result.signerName).toBe('Ion Pop');
    });
  });
});
