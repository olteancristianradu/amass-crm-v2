import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';
import { hashToken } from './password-reset.helpers';

type Mock = ReturnType<typeof vi.fn>;

describe('EmailVerificationService', () => {
  let svc: EmailVerificationService;
  let tokenCreate: Mock;
  let tokenFindUnique: Mock;
  let tokenUpdateMany: Mock;
  let userFindUnique: Mock;
  let userUpdate: Mock;
  let auditLog: Mock;
  let runWithTenant: Mock;

  beforeEach(() => {
    tokenCreate = vi.fn();
    tokenFindUnique = vi.fn();
    tokenUpdateMany = vi.fn();
    userFindUnique = vi.fn();
    userUpdate = vi.fn();
    auditLog = vi.fn().mockResolvedValue(undefined);

    const tx = {
      emailVerificationToken: { create: tokenCreate, updateMany: tokenUpdateMany },
      user: { update: userUpdate },
    };

    runWithTenant = vi.fn(async (_tid: string, fn: (t: typeof tx) => unknown) => fn(tx));

    const prisma = {
      runWithTenant,
      // top-level findUnique used by confirm() before runWithTenant
      emailVerificationToken: { findUnique: tokenFindUnique },
      user: { findUnique: userFindUnique },
    } as unknown as ConstructorParameters<typeof EmailVerificationService>[0];
    const audit = { log: auditLog } as unknown as ConstructorParameters<typeof EmailVerificationService>[1];
    svc = new EmailVerificationService(prisma, audit);
  });

  describe('issue', () => {
    it('creates a token row with hashed value and emits audit', async () => {
      const out = await svc.issue('user-1', 'tenant-1');
      expect(typeof out.verifyUrl).toBe('string');
      expect(out.verifyUrl.length).toBeGreaterThan(20);

      // create call: tokenHash must NOT equal the raw token
      const arg = tokenCreate.mock.calls[0][0] as { data: { tokenHash: string; userId: string } };
      expect(arg.data.userId).toBe('user-1');
      expect(arg.data.tokenHash).not.toBe(out.verifyUrl);
      expect(arg.data.tokenHash).toBe(hashToken(out.verifyUrl));

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.email_verification.issued' }),
      );
    });
  });

  describe('confirm', () => {
    it('rejects an unknown token', async () => {
      tokenFindUnique.mockResolvedValueOnce(null);
      await expect(svc.confirm('unknown-token')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an expired token', async () => {
      tokenFindUnique.mockResolvedValueOnce({
        userId: 'u-1',
        tokenHash: hashToken('t'),
        usedAt: null,
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(svc.confirm('t')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an already-used token', async () => {
      tokenFindUnique.mockResolvedValueOnce({
        userId: 'u-1',
        tokenHash: hashToken('t'),
        usedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
      });
      await expect(svc.confirm('t')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when the user is missing (deleted between issue and confirm)', async () => {
      tokenFindUnique.mockResolvedValueOnce({
        userId: 'u-1',
        tokenHash: hashToken('t'),
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      userFindUnique.mockResolvedValueOnce(null);
      await expect(svc.confirm('t')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('marks token used + sets emailVerifiedAt + emits audit on success', async () => {
      tokenFindUnique.mockResolvedValueOnce({
        userId: 'u-1',
        tokenHash: hashToken('t'),
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      userFindUnique.mockResolvedValueOnce({ id: 'u-1', tenantId: 'tenant-1' });
      tokenUpdateMany.mockResolvedValue({ count: 1 });
      userUpdate.mockResolvedValue({ id: 'u-1' });

      await svc.confirm('t');

      expect(tokenUpdateMany).toHaveBeenCalled();
      expect(userUpdate).toHaveBeenCalledWith({
        where: { id: 'u-1' },
        data: { emailVerifiedAt: expect.any(Date) },
      });
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.email_verification.confirmed' }),
      );
    });

    it('detects race: token consumed between findUnique and updateMany', async () => {
      tokenFindUnique.mockResolvedValueOnce({
        userId: 'u-1',
        tokenHash: hashToken('t'),
        usedAt: null,
        expiresAt: new Date(Date.now() + 60_000),
      });
      userFindUnique.mockResolvedValueOnce({ id: 'u-1', tenantId: 'tenant-1' });
      tokenUpdateMany.mockResolvedValue({ count: 0 }); // consumed by another request

      await expect(svc.confirm('t')).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
