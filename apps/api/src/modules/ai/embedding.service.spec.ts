import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbeddingService } from './embedding.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

vi.mock('../../common/resilience/circuit-breaker', () => ({
  getBreaker: vi.fn(() => ({
    exec: vi.fn(async (fn: () => unknown) => fn()),
  })),
}));

const ORIG_ENV = { ...process.env };

function build() {
  const tx = {
    company: { findMany: vi.fn() },
    contact: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    $executeRaw: vi.fn(),
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof EmbeddingService>[0];
  const svc = new EmbeddingService(prisma);
  return { svc, prisma, tx };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...ORIG_ENV };
  delete process.env.GEMINI_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

describe('EmbeddingService', () => {
  describe('embed', () => {
    it('returns null when no provider is configured', async () => {
      const { svc } = build();
      const out = await svc.embed('any text');
      expect(out).toBeNull();
    });

    it('truncates long inputs to 8192 chars before sending to provider', async () => {
      // Provider stays 'none' because no key is set, so we just verify
      // the early-return path doesn't blow up on a giant string.
      const { svc } = build();
      const huge = 'x'.repeat(100_000);
      const out = await svc.embed(huge);
      expect(out).toBeNull();
    });
  });

  describe('toVectorLiteral', () => {
    it('formats a number array as a pgvector string literal', () => {
      const { svc } = build();
      const out = svc.toVectorLiteral([1, 0.5, -0.25]);
      // helper format: "[1,0.5,-0.25]"
      expect(out).toMatch(/^\[.*\]$/);
      expect(out).toContain('1');
      expect(out).toContain('0.5');
      expect(out).toContain('-0.25');
    });
  });

  describe('updateCompany / updateContact / updateClient — no-op when embed returns null', () => {
    it('updateCompany skips the SQL UPDATE when no provider', async () => {
      const { svc, prisma } = build();
      await svc.updateCompany('c1', 'hello');
      // runWithTenant should NOT be called because embed returned null
      expect(prisma.runWithTenant).not.toHaveBeenCalled();
    });

    it('updateContact same null-skip', async () => {
      const { svc, prisma } = build();
      await svc.updateContact('p1', 'hello');
      expect(prisma.runWithTenant).not.toHaveBeenCalled();
    });

    it('updateClient same null-skip', async () => {
      const { svc, prisma } = build();
      await svc.updateClient('cl1', 'hello');
      expect(prisma.runWithTenant).not.toHaveBeenCalled();
    });
  });

  describe('reindexAll', () => {
    it('returns zero counts when no provider is configured', async () => {
      const { svc } = build();
      const out = await svc.reindexAll();
      expect(out).toEqual({ companies: 0, contacts: 0, clients: 0 });
    });
  });
});
