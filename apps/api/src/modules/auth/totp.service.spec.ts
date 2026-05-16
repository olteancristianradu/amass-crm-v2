import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';

vi.mock('otplib', () => ({
  generateSecret: vi.fn(() => 'TESTSECRET'),
  generateURI: vi.fn(() => 'otpauth://totp/AMASS%20CRM:a@x.ro?secret=TESTSECRET'),
  verify: vi.fn(),
}));
vi.mock('qrcode', () => ({
  toDataURL: vi.fn(async () => 'data:image/png;base64,QR'),
}));
vi.mock('bcrypt', () => ({
  compare: vi.fn(),
}));
vi.mock('../../common/crypto/encryption', () => ({
  encrypt: vi.fn((s: string) => `ENC(${s})`),
  decrypt: vi.fn((s: string) => s.replace(/^ENC\(|\)$/g, '')),
}));

import { TotpService } from './totp.service';
import * as otplib from 'otplib';
import * as bcrypt from 'bcrypt';

function build() {
  const prisma = {
    user: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  } as unknown as ConstructorParameters<typeof TotpService>[0];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof TotpService>[1];
  const svc = new TotpService(prisma, audit);
  return { svc, prisma, audit };
}

describe('TotpService.beginSetup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws Unauthorized when user is missing', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce(null);
    await expect(h.svc.beginSetup('u', 't')).rejects.toThrow(UnauthorizedException);
  });

  it('refuses to re-setup when 2FA is already enabled', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u',
      tenantId: 't',
      email: 'a@x.ro',
      totpEnabled: true,
    } as never);
    await expect(h.svc.beginSetup('u', 't')).rejects.toThrow(BadRequestException);
  });

  it('persists encrypted secret + returns QR url', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u',
      tenantId: 't',
      email: 'a@x.ro',
      totpEnabled: false,
    } as never);
    vi.mocked(h.prisma.user.update).mockResolvedValueOnce({} as never);
    const out = await h.svc.beginSetup('u', 't');
    const updateArgs = vi.mocked(h.prisma.user.update).mock.calls[0][0];
    expect(updateArgs.data.totpSecret).toBe('ENC(TESTSECRET)');
    expect(out.qrDataUrl).toMatch(/^data:image\/png/);
    expect(out.tempSecret).toBe('TESTSECRET');
  });
});

describe('TotpService.enable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses when setup was never started', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u',
      tenantId: 't',
      totpSecret: null,
      totpEnabled: false,
    } as never);
    await expect(h.svc.enable('u', 't', '123456')).rejects.toThrow(BadRequestException);
  });

  it('refuses when 2FA is already enabled', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u',
      tenantId: 't',
      totpSecret: 'ENC(SEC)',
      totpEnabled: true,
    } as never);
    await expect(h.svc.enable('u', 't', '123456')).rejects.toThrow(BadRequestException);
  });

  it('refuses when the code does not verify', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u',
      tenantId: 't',
      totpSecret: 'ENC(SEC)',
      totpEnabled: false,
    } as never);
    vi.mocked(otplib.verify).mockResolvedValueOnce({ valid: false } as never);
    await expect(h.svc.enable('u', 't', '000000')).rejects.toThrow(BadRequestException);
    expect(h.prisma.user.update).not.toHaveBeenCalled();
  });

  it('flips totpEnabled true + audits when code is valid', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u',
      tenantId: 't',
      totpSecret: 'ENC(SEC)',
      totpEnabled: false,
    } as never);
    vi.mocked(otplib.verify).mockResolvedValueOnce({ valid: true } as never);
    const result = await h.svc.enable('u', 't', '123456');
    const updateData = vi.mocked(h.prisma.user.update).mock.calls[0][0].data as {
      totpEnabled: boolean;
      totpBackupCodes: string[];
    };
    expect(updateData.totpEnabled).toBe(true);
    // B2-PR5: enable now also generates 10 backup codes, stored as SHA-256 hashes.
    expect(updateData.totpBackupCodes).toHaveLength(10);
    expect(result.backupCodes).toHaveLength(10);
    expect(result.backupCodes[0]).toMatch(/^[a-z0-9]{8}$/);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.totp.enabled', actorId: 'u' }),
    );
  });
});

describe('TotpService.disable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws Unauthorized on missing user', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce(null);
    await expect(h.svc.disable('u', 't', 'pw')).rejects.toThrow(UnauthorizedException);
  });

  it('refuses when 2FA is not enabled', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u',
      tenantId: 't',
      totpEnabled: false,
      passwordHash: 'h',
    } as never);
    await expect(h.svc.disable('u', 't', 'pw')).rejects.toThrow(BadRequestException);
  });

  it('refuses when the password does not match', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u',
      tenantId: 't',
      totpEnabled: true,
      passwordHash: 'h',
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);
    await expect(h.svc.disable('u', 't', 'wrong')).rejects.toThrow(UnauthorizedException);
    expect(h.prisma.user.update).not.toHaveBeenCalled();
  });

  it('clears totpSecret + audit log when password is correct', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u',
      tenantId: 't',
      totpEnabled: true,
      passwordHash: 'h',
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
    await h.svc.disable('u', 't', 'pw');
    const update = vi.mocked(h.prisma.user.update).mock.calls[0][0];
    expect(update.data).toEqual({ totpEnabled: false, totpSecret: null });
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.totp.disabled' }),
    );
  });
});

describe('TotpService.verify', () => {
  beforeEach(() => vi.clearAllMocks());

  it('decrypts the stored secret before checking the code', async () => {
    const h = build();
    vi.mocked(otplib.verify).mockResolvedValueOnce({ valid: true } as never);
    await h.svc.verify('ENC(SEC)', '654321');
    const args = vi.mocked(otplib.verify).mock.calls[0][0];
    expect(args.secret).toBe('SEC');
    expect(args.token).toBe('654321');
  });
});

describe('TotpService.regenerateBackupCodes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws Unauthorized when user is missing', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce(null);
    await expect(h.svc.regenerateBackupCodes('u', 't', 'pw')).rejects.toThrow(UnauthorizedException);
  });

  it('refuses when 2FA is not enabled (codes only make sense with TOTP active)', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u', tenantId: 't', totpEnabled: false, passwordHash: 'h',
    } as never);
    await expect(h.svc.regenerateBackupCodes('u', 't', 'pw')).rejects.toThrow(BadRequestException);
  });

  it('rejects wrong password — defends against stolen-JWT replay', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u', tenantId: 't', totpEnabled: true, passwordHash: 'h',
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(false as never);
    await expect(h.svc.regenerateBackupCodes('u', 't', 'wrong-pw')).rejects.toThrow(UnauthorizedException);
    expect(h.prisma.user.update).not.toHaveBeenCalled();
  });

  it('on success: writes 10 fresh hashes, returns 10 raw codes, audit-logs', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u', tenantId: 't', totpEnabled: true, passwordHash: 'h',
    } as never);
    vi.mocked(bcrypt.compare).mockResolvedValueOnce(true as never);
    vi.mocked(h.prisma.user.update).mockResolvedValueOnce({} as never);

    const result = await h.svc.regenerateBackupCodes('u', 't', 'pw');
    expect(result.backupCodes).toHaveLength(10);
    expect(result.backupCodes[0]).toMatch(/^[a-z0-9]{8}$/);
    // Each code unique.
    expect(new Set(result.backupCodes).size).toBe(10);

    const updateData = vi.mocked(h.prisma.user.update).mock.calls[0][0].data as {
      totpBackupCodes: string[];
    };
    expect(updateData.totpBackupCodes).toHaveLength(10);
    // Hashes are not the raw codes.
    expect(updateData.totpBackupCodes[0]).not.toBe(result.backupCodes[0]);

    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.totp.backup_codes_regenerated',
        actorId: 'u',
        metadata: { count: 10 },
      }),
    );
  });
});

describe('TotpService.backupCodesRemaining', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 0 when user has no TOTP enabled (no codes to count)', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u', tenantId: 't', totpEnabled: false, totpBackupCodes: null,
    } as never);
    const r = await h.svc.backupCodesRemaining('u', 't');
    expect(r).toEqual({ remaining: 0 });
  });

  it('returns 0 when user is missing entirely (no auth leak)', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce(null);
    const r = await h.svc.backupCodesRemaining('u', 't');
    expect(r).toEqual({ remaining: 0 });
  });

  it('returns the JSON-array length when TOTP is enabled', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u', tenantId: 't', totpEnabled: true,
      totpBackupCodes: ['hash1', 'hash2', 'hash3', 'hash4', 'hash5'],
    } as never);
    const r = await h.svc.backupCodesRemaining('u', 't');
    expect(r).toEqual({ remaining: 5 });
  });

  it('returns 0 when totpBackupCodes is null (TOTP enabled but never enrolled with B2-PR5)', async () => {
    const h = build();
    vi.mocked(h.prisma.user.findFirst).mockResolvedValueOnce({
      id: 'u', tenantId: 't', totpEnabled: true, totpBackupCodes: null,
    } as never);
    const r = await h.svc.backupCodesRemaining('u', 't');
    expect(r).toEqual({ remaining: 0 });
  });
});
