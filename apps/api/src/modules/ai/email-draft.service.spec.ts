import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { EmailDraftService } from './email-draft.service';

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
  } as unknown as ConstructorParameters<typeof EmailDraftService>[0];
  return { svc: new EmailDraftService(prisma), tx };
}

describe('EmailDraftService.draft', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws CONTACT_NOT_FOUND when the contact is missing or in another tenant', async () => {
    const { svc, tx } = build();
    tx.contact.findFirst.mockResolvedValueOnce(null);
    await expect(
      svc.draft('ghost', 'check in'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('falls back to a Romanian static template when no AI provider is set', async () => {
    const { svc, tx } = build();
    tx.contact.findFirst.mockResolvedValueOnce({
      firstName: 'Ion',
      lastName: 'Pop',
      jobTitle: 'CTO',
      email: 'ion@acme.ro',
      company: { name: 'Acme', industry: 'IT' },
    });

    const out = await svc.draft('contact-1', 'urmare după demo de săptămâna trecută');

    expect(out.subject).toContain('urmare');
    expect(out.body).toContain('Bună, Ion'); // greeting reflects friendly tone default
    expect(out.body).toContain('Acme');
    expect(out.tone).toBe('friendly');
    expect(out.generatedAt).toBeDefined();
  });

  it('switches to a formal greeting when tone=formal', async () => {
    const { svc, tx } = build();
    tx.contact.findFirst.mockResolvedValueOnce({
      firstName: 'Maria',
      lastName: 'Ionescu',
      jobTitle: null,
      email: null,
      company: null,
    });
    const out = await svc.draft('c2', 'follow up trimis ofertă', 'formal');
    expect(out.body).toContain('Stimate Maria');
    expect(out.tone).toBe('formal');
  });

  it('handles contacts with no company gracefully', async () => {
    const { svc, tx } = build();
    tx.contact.findFirst.mockResolvedValueOnce({
      firstName: 'Vlad',
      lastName: 'Popescu',
      jobTitle: null,
      email: null,
      company: null,
    });
    const out = await svc.draft('c3', 'mesaj de mulțumire');
    expect(out.body).not.toContain('undefined');
    expect(out.body).toContain('Vlad');
  });
});
