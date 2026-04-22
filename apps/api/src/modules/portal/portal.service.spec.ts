import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PortalService } from './portal.service';

// Shared mocks — typed loose so each test can override.
type Mock = ReturnType<typeof vi.fn>;

function build() {
  const runWithTenant: Mock = vi.fn();
  const findUnique: Mock = vi.fn();
  const audit = { log: vi.fn() } as const;
  const svc = new PortalService(
    { runWithTenant, portalToken: { findUnique } } as unknown as import('../../infra/prisma/prisma.service').PrismaService,
    audit as unknown as import('../audit/audit.service').AuditService,
  );
  return { svc, runWithTenant, findUnique, audit };
}

describe('PortalService', () => {
  beforeEach(() => vi.clearAllMocks());

  describe('requestAccess', () => {
    it('creates a portal token with 24h expiry', async () => {
      const { svc, runWithTenant } = build();
      const row = { id: 't1', token: 'abc123', expiresAt: new Date(Date.now() + 86_400_000), email: 'test@example.com' };
      runWithTenant.mockResolvedValue(row);

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
    it('throws Unauthorized when token not found', async () => {
      const { svc, findUnique } = build();
      findUnique.mockResolvedValue(null);
      await expect(svc.verifyToken('tenant-1', 'bad')).rejects.toThrow(UnauthorizedException);
    });

    it('throws Unauthorized when token is expired', async () => {
      const { svc, findUnique } = build();
      findUnique.mockResolvedValue({ id: 't1', tenantId: 'tenant-1', expiresAt: new Date(0) });
      await expect(svc.verifyToken('tenant-1', 'expired')).rejects.toThrow(UnauthorizedException);
    });

    it('returns valid info for a correct token', async () => {
      const { svc, findUnique } = build();
      findUnique.mockResolvedValue({
        id: 't1',
        tenantId: 'tenant-1',
        email: 'client@example.com',
        companyId: 'comp-1',
        clientId: null,
        expiresAt: new Date(Date.now() + 10_000),
      });
      const r = await svc.verifyToken('tenant-1', 'ok');
      expect(r.valid).toBe(true);
      expect(r.email).toBe('client@example.com');
    });

    it('throws Forbidden + audits when token belongs to a different tenant (tenant confusion attack)', async () => {
      const { svc, findUnique, audit } = build();
      findUnique.mockResolvedValue({
        id: 't1',
        tenantId: 'tenant-REAL',
        email: 'victim@example.com',
        companyId: 'comp-1',
        clientId: null,
        expiresAt: new Date(Date.now() + 10_000),
      });

      await expect(svc.verifyToken('tenant-ATTACKER', 'ok')).rejects.toThrow(ForbiddenException);
      expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
        action: 'portal.tenant_mismatch',
        tenantId: 'tenant-REAL',
        metadata: expect.objectContaining({ headerTenantId: 'tenant-ATTACKER' }),
      }));
    });
  });

  describe('signQuote', () => {
    it('throws BadRequest when quote status is not SENT', async () => {
      const { svc, findUnique, runWithTenant } = build();
      findUnique.mockResolvedValue({
        id: 't1',
        tenantId: 'tenant-1',
        companyId: 'comp-1',
        email: 'c@e.com',
        clientId: null,
        expiresAt: new Date(Date.now() + 10_000),
      });
      runWithTenant.mockResolvedValueOnce({ id: 'q1', status: 'ACCEPTED', number: 'OF-001', companyId: 'comp-1' });
      await expect(
        svc.signQuote('tenant-1', 'token', 'q1', { signatureBase64: 'abc', signerName: 'Ion Pop' }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
