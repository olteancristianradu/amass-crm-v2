import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { SigningService } from './signing.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

/**
 * Minimal valid PNG: 8-byte magic + IHDR chunk (1×1 pixel, no actual data).
 * The renderer never actually decodes the image — it just hashes the bytes —
 * so we don't need a fully-formed PNG. The 16-byte prefix (8 magic + 4 len
 * + 4 type) is what assertPng() validates.
 */
const VALID_PNG_PREFIX = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0x00, 0x00, 0x00, 0x0d]), // length
  Buffer.from('IHDR'),
  Buffer.alloc(8), // dummy IHDR payload + CRC stand-in
]);
const VALID_PNG_DATAURL = `data:image/png;base64,${VALID_PNG_PREFIX.toString('base64')}`;

function build() {
  const svc = new SigningService(
    { runWithTenant: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { svc };
}

describe('SigningService.assertPng', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts a real PNG header', () => {
    const { svc } = build();
    const out = svc.assertPng(VALID_PNG_DATAURL);
    expect(out.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  });

  it('rejects SVG payload (T-ESIGN-T-02 main case)', () => {
    const { svc } = build();
    const svg = `data:image/png;base64,${Buffer.from('<svg onclick="alert(1)"/>').toString('base64')}`;
    expect(() => svc.assertPng(svg)).toThrow(BadRequestException);
  });

  it('rejects HTML payload disguised as PNG', () => {
    const { svc } = build();
    const html = `data:image/png;base64,${Buffer.from('<html><script>alert(1)</script>').toString('base64')}`;
    expect(() => svc.assertPng(html)).toThrow(BadRequestException);
  });

  it('rejects bytes that start with the magic but lack IHDR chunk', () => {
    const { svc } = build();
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0x00, 0x00, 0x00, 0x00]), // length 0
      Buffer.from('NOTI'), // wrong chunk type
      Buffer.from([0x00, 0x00, 0x00, 0x00]),
    ]);
    const url = `data:image/png;base64,${fake.toString('base64')}`;
    expect(() => svc.assertPng(url)).toThrow(BadRequestException);
  });

  it('rejects empty bodies', () => {
    const { svc } = build();
    expect(() => svc.assertPng('data:image/png;base64,')).toThrow(BadRequestException);
  });

  it('rejects bodies over 1 MB', () => {
    const { svc } = build();
    const big = Buffer.alloc(1_048_577, 0); // 1MB + 1 byte
    const url = `data:image/png;base64,${big.toString('base64')}`;
    expect(() => svc.assertPng(url)).toThrow(BadRequestException);
  });

  it('rejects payload without data: prefix (no comma)', () => {
    const { svc } = build();
    expect(() => svc.assertPng('justbase64chars')).toThrow(BadRequestException);
  });
});

describe('SigningService.sign idempotency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the prior outcome when the signer is already SIGNED (idempotent retry)', async () => {
    const ceremony = {
      loadSignerByToken: vi.fn().mockResolvedValue({
        id: 's1',
        tenantId: 'tenant-1',
        contractId: 'c1',
        signerEmail: 'a@b.test',
        status: 'SIGNED',
        signedAt: new Date('2026-01-01T00:00:00.000Z'),
        signingOrder: 0,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      }),
    };
    const prisma = {
      runWithTenant: vi.fn(async (_id: string, fn: (t: unknown) => unknown) =>
        fn({
          contractSignature: { count: vi.fn().mockResolvedValue(0) },
        }),
      ),
    };
    const svc = new SigningService(
      prisma as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      ceremony as never,
    );
    const result = await svc.sign(
      '0'.repeat(64),
      { signatureImageBase64: VALID_PNG_DATAURL, agreedAt: new Date() } as never,
      { ipAddress: '1.2.3.4', userAgent: 'ua' },
    );
    expect(result.status).toBe('SIGNED');
    expect(result.contractCompleted).toBe(true);
  });

  it('throws 409 when ceremony is terminal (DECLINED)', async () => {
    const ceremony = {
      loadSignerByToken: vi.fn().mockResolvedValue({
        id: 's1',
        tenantId: 'tenant-1',
        contractId: 'c1',
        signerEmail: 'a@b.test',
        status: 'DECLINED',
        signedAt: null,
        signingOrder: 0,
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      }),
    };
    const svc = new SigningService(
      { runWithTenant: vi.fn() } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      ceremony as never,
    );
    await expect(
      svc.sign(
        '0'.repeat(64),
        { signatureImageBase64: VALID_PNG_DATAURL, agreedAt: new Date() } as never,
        { ipAddress: '1.2.3.4', userAgent: 'ua' },
      ),
    ).rejects.toThrow(ConflictException);
  });
});
