import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';

vi.mock('bcrypt', () => ({
  default: { hash: vi.fn(async (pw: string) => `hashed(${pw})`) },
}));

function build() {
  const tx = {
    passwordResetToken: { create: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    user: { update: vi.fn() },
    session: { updateMany: vi.fn() },
  };
  const prisma = {
    tenant: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    passwordResetToken: { findUnique: vi.fn() },
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof PasswordResetService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof PasswordResetService>[1];
  return { svc: new PasswordResetService(prisma, audit), prisma, tx, audit };
}

describe('PasswordResetService.request', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty {} for unknown tenant slug (no enumeration)', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue(null);
    const out = await h.svc.request('a@b.com', 'unknown-slug');
    expect(out).toEqual({});
    expect(h.tx.passwordResetToken.create).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });

  it('returns empty {} when user is missing', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 't-1' } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue(null);
    const out = await h.svc.request('a@b.com', 'slug');
    expect(out).toEqual({});
  });

  it('returns empty {} when user is inactive', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 't-1' } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue({ id: 'u-1', isActive: false } as never);
    const out = await h.svc.request('a@b.com', 'slug');
    expect(out).toEqual({});
  });

  it('issues a token + audit log on success and returns the raw token', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 't-1' } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue({ id: 'u-1', isActive: true } as never);
    h.tx.passwordResetToken.create.mockResolvedValue({ id: 'tok-1' });
    const out = await h.svc.request('a@b.com', 'slug', '1.2.3.4');
    expect(out.resetUrl).toBeTruthy();
    expect(out.resetUrl).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(h.tx.passwordResetToken.create).toHaveBeenCalled();
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_reset.requested', ipAddress: '1.2.3.4' }),
    );
  });

  it('lowercases the email when looking up the user', async () => {
    const h = build();
    vi.mocked(h.prisma.tenant.findUnique).mockResolvedValue({ id: 't-1' } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue({ id: 'u-1', isActive: true } as never);
    h.tx.passwordResetToken.create.mockResolvedValue({ id: 'tok-1' });
    await h.svc.request('A@B.COM', 'slug');
    const lookupArg = vi.mocked(h.prisma.user.findUnique).mock.calls[0]![0] as {
      where: { tenantId_email: { email: string } };
    };
    expect(lookupArg.where.tenantId_email.email).toBe('a@b.com');
  });
});

describe('PasswordResetService.confirm', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects passwords shorter than 8 chars', async () => {
    const h = build();
    await expect(h.svc.confirm('rawtoken', 'short')).rejects.toThrow(BadRequestException);
    expect(vi.mocked(h.prisma.passwordResetToken.findUnique)).not.toHaveBeenCalled();
  });

  it('rejects unknown token (RESET_TOKEN_INVALID)', async () => {
    const h = build();
    vi.mocked(h.prisma.passwordResetToken.findUnique).mockResolvedValue(null);
    await expect(h.svc.confirm('rawtoken', 'newpassword123')).rejects.toThrow(BadRequestException);
  });

  it('rejects expired token', async () => {
    const h = build();
    vi.mocked(h.prisma.passwordResetToken.findUnique).mockResolvedValue({
      tokenHash: 'h',
      userId: 'u-1',
      usedAt: null,
      expiresAt: new Date('2020-01-01'),
    } as never);
    await expect(h.svc.confirm('rawtoken', 'newpassword123')).rejects.toThrow(BadRequestException);
  });

  it('rejects already-used token', async () => {
    const h = build();
    vi.mocked(h.prisma.passwordResetToken.findUnique).mockResolvedValue({
      tokenHash: 'h',
      userId: 'u-1',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    await expect(h.svc.confirm('rawtoken', 'newpassword123')).rejects.toThrow(BadRequestException);
  });

  it('rejects when user is missing or inactive', async () => {
    const h = build();
    vi.mocked(h.prisma.passwordResetToken.findUnique).mockResolvedValue({
      tokenHash: 'h',
      userId: 'u-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue({ id: 'u-1', isActive: false } as never);
    await expect(h.svc.confirm('rawtoken', 'newpassword123')).rejects.toThrow(BadRequestException);
  });

  it('happy path: marks token used, updates password, revokes all sessions, audits', async () => {
    const h = build();
    vi.mocked(h.prisma.passwordResetToken.findUnique).mockResolvedValue({
      tokenHash: 'h',
      userId: 'u-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue({
      id: 'u-1', tenantId: 't-1', isActive: true,
    } as never);
    h.tx.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
    h.tx.user.update.mockResolvedValue({ id: 'u-1' });
    h.tx.session.updateMany.mockResolvedValue({ count: 3 });

    await h.svc.confirm('rawtoken', 'newpassword123');

    expect(h.tx.passwordResetToken.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ usedAt: expect.any(Date) }) }),
    );
    expect(h.tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u-1' },
        data: expect.objectContaining({ passwordHash: 'hashed(newpassword123)' }),
      }),
    );
    expect(h.tx.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'u-1', revokedAt: null },
      }),
    );
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.password_reset.confirmed' }),
    );
  });

  it('race-loss: throws RESET_TOKEN_INVALID when updateMany finds 0 rows', async () => {
    const h = build();
    vi.mocked(h.prisma.passwordResetToken.findUnique).mockResolvedValue({
      tokenHash: 'h',
      userId: 'u-1',
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    } as never);
    vi.mocked(h.prisma.user.findUnique).mockResolvedValue({
      id: 'u-1', tenantId: 't-1', isActive: true,
    } as never);
    h.tx.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(h.svc.confirm('rawtoken', 'newpassword123')).rejects.toThrow(BadRequestException);
  });
});
