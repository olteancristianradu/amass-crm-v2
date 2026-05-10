import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

import { SearchService } from './search.service';

function build() {
  const queryRaw = vi.fn();
  const tx = { $queryRaw: queryRaw };
  const prisma = {
    runWithTenant: vi.fn(
      async (
        _id: string,
        modeOrFn: 'ro' | 'rw' | ((t: unknown) => unknown),
        maybeFn?: (t: typeof tx) => unknown,
      ) => {
        const fn = (typeof modeOrFn === 'function' ? modeOrFn : maybeFn) as (
          t: typeof tx,
        ) => unknown;
        return fn(tx);
      },
    ),
  } as unknown as ConstructorParameters<typeof SearchService>[0];

  const embedding = {
    embed: vi.fn(),
    toVectorLiteral: vi.fn((v: number[]) => `[${v.join(',')}]`),
  } as unknown as ConstructorParameters<typeof SearchService>[1];

  const svc = new SearchService(prisma, embedding);
  return { svc, prisma, embedding, queryRaw };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SearchService.semanticSearch', () => {
  it('returns empty array when embedding is null (e.g. OpenAI down)', async () => {
    const { svc, embedding, queryRaw } = build();
    (embedding.embed as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const out = await svc.semanticSearch('test query');
    expect(out).toEqual([]);
    // No DB queries should have run.
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('aggregates rows from all 3 entity types and sorts by score desc', async () => {
    const { svc, embedding, queryRaw } = build();
    (embedding.embed as ReturnType<typeof vi.fn>).mockResolvedValueOnce([0.1, 0.2]);
    queryRaw
      .mockResolvedValueOnce([{ id: 'c1', label: 'ACME SRL', subtitle: 'Tech', score: 0.92 }])
      .mockResolvedValueOnce([{ id: 'p1', label: 'Andrei P', subtitle: 'CTO', score: 0.71 }])
      .mockResolvedValueOnce([{ id: 'cl1', label: 'Maria I', subtitle: 'Buc.', score: 0.85 }]);

    const out = await svc.semanticSearch('query', 5);

    expect(out).toHaveLength(3);
    // Sort order: 0.92 → 0.85 → 0.71
    expect(out.map((r) => r.id)).toEqual(['c1', 'cl1', 'p1']);
    expect(out.map((r) => r.type)).toEqual(['company', 'client', 'contact']);
    // Score must be coerced to number even if DB returns Decimal/string.
    expect(typeof out[0].score).toBe('number');
  });

  it('caps result count at provided limit', async () => {
    const { svc, embedding, queryRaw } = build();
    (embedding.embed as ReturnType<typeof vi.fn>).mockResolvedValueOnce([0.1, 0.2]);
    queryRaw
      .mockResolvedValueOnce([
        { id: 'c1', label: 'A', subtitle: '', score: 0.9 },
        { id: 'c2', label: 'B', subtitle: '', score: 0.8 },
      ])
      .mockResolvedValueOnce([{ id: 'p1', label: 'P1', subtitle: '', score: 0.7 }])
      .mockResolvedValueOnce([]);

    const out = await svc.semanticSearch('q', 2);
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.id)).toEqual(['c1', 'c2']);
  });
});

describe('SearchService.findSimilar', () => {
  it('returns scored rows for company type', async () => {
    const { svc, queryRaw } = build();
    queryRaw.mockResolvedValueOnce([
      { id: 'c2', label: 'Beta SA', subtitle: 'Buc.', score: 0.81 },
    ]);
    const out = await svc.findSimilar('company', 'c1', 5);
    expect(out).toEqual([
      { id: 'c2', label: 'Beta SA', subtitle: 'Buc.', score: 0.81, type: 'company' },
    ]);
  });

  it('returns scored rows for contact type', async () => {
    const { svc, queryRaw } = build();
    queryRaw.mockResolvedValueOnce([
      { id: 'p2', label: 'Ana M', subtitle: 'CEO', score: 0.65 },
    ]);
    const out = await svc.findSimilar('contact', 'p1', 5);
    expect(out[0].type).toBe('contact');
  });

  it('returns scored rows for client type', async () => {
    const { svc, queryRaw } = build();
    queryRaw.mockResolvedValueOnce([
      { id: 'cl2', label: 'X Y', subtitle: '', score: 0.55 },
    ]);
    const out = await svc.findSimilar('client', 'cl1', 5);
    expect(out[0].type).toBe('client');
  });
});
