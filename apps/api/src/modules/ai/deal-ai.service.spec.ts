import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DealAiService } from './deal-ai.service';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

vi.mock('../../config/env', () => ({
  loadEnv: () => ({
    GEMINI_API_KEY: undefined,
    ANTHROPIC_API_KEY: undefined,
  }),
}));

function build() {
  const tx = {
    deal: { findFirst: vi.fn() },
    company: { findFirst: vi.fn() },
    contact: { findFirst: vi.fn() },
  };
  const prisma = {
    runWithTenant: vi.fn(async (
      _id: string,
      _modeOrFn: unknown,
      maybeFn?: unknown,
    ) => {
      const fn = typeof _modeOrFn === 'function' ? _modeOrFn : maybeFn;
      return (fn as (t: typeof tx) => Promise<unknown>)(tx);
    }),
  } as unknown as ConstructorParameters<typeof DealAiService>[0];
  const svc = new DealAiService(prisma);
  return { svc, prisma, tx };
}

describe('DealAiService.suggest', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the "no provider configured" sentinel when no API key is set', async () => {
    const { svc } = build();
    const out = await svc.suggest('deal-1');
    expect(out.priority).toBe('LOW');
    expect(out.action).toMatch(/GEMINI|ANTHROPIC/);
    expect(out.suggestedAt).toBeDefined();
  });

  it('does NOT touch the DB when the provider is "none"', async () => {
    const { svc, prisma } = build();
    await svc.suggest('deal-1');
    expect(prisma.runWithTenant).not.toHaveBeenCalled();
  });

  // The full prompt path requires a real Gemini/Anthropic SDK in env;
  // covered by the e2e suite. Here we lock in the no-key behavior so the
  // /ai/deals/:id/suggest endpoint returns a useful payload even without
  // billing set up.
});
