import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

const ORIGINAL_ENV = { ...process.env };

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

// Vitest 4: arrow functions cannot be constructors. Use class syntax so
// `new Anthropic({...})` / `new GoogleGenAI({...})` work like prod code.
const anthropicCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    messages = { create: anthropicCreate };
    constructor(_opts: unknown) {}
  }
  return { default: Anthropic };
});

const geminiGenerate = vi.fn();
vi.mock('@google/genai', () => {
  class GoogleGenAI {
    models = { generateContent: geminiGenerate };
    constructor(_opts: unknown) {}
  }
  return { GoogleGenAI };
});

vi.mock('../../common/resilience/circuit-breaker', () => ({
  getBreaker: () => ({ exec: <T>(fn: () => Promise<T>) => fn() }),
}));

import { EnrichmentService } from './enrichment.service';

type Mock = ReturnType<typeof vi.fn>;

describe('EnrichmentService', () => {
  let svc: EnrichmentService;
  let companyFindFirst: Mock;
  let contactFindFirst: Mock;
  let dealCount: Mock;
  let noteCount: Mock;
  let callCount: Mock;
  let emailCount: Mock;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = 'test-secret-min-32-chars-padding';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-min-32-chars-pad';
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    process.env.DATABASE_URL = 'postgresql://x:y@localhost:5432/z?schema=public';
    process.env.REDIS_URL = 'redis://localhost:6379';
    process.env.MINIO_ENDPOINT = 'http://localhost:9000';
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GEMINI_API_KEY;

    anthropicCreate.mockReset();
    geminiGenerate.mockReset();

    companyFindFirst = vi.fn();
    contactFindFirst = vi.fn();
    dealCount = vi.fn().mockResolvedValue(0);
    noteCount = vi.fn().mockResolvedValue(0);
    callCount = vi.fn().mockResolvedValue(0);
    emailCount = vi.fn().mockResolvedValue(0);

    // Force a fresh env cache so the service constructor sees our overrides.
    return import('../../config/env').then((m) => {
      m._resetEnvCacheForTests();
    });
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  function makeSvc(): void {
    const tx = {
      company: { findFirst: companyFindFirst },
      contact: { findFirst: contactFindFirst },
      deal: { count: dealCount },
      note: { count: noteCount },
      call: { count: callCount },
      emailMessage: { count: emailCount },
    };
    const prisma = {
      runWithTenant: vi.fn(async (_tid: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as ConstructorParameters<typeof EnrichmentService>[0];
    svc = new EnrichmentService(prisma);
  }

  describe('enrichCompany', () => {
    it('throws NotFound when the company does not exist', async () => {
      process.env.GEMINI_API_KEY = 'fake-key';
      const { _resetEnvCacheForTests } = await import('../../config/env');
      _resetEnvCacheForTests();
      makeSvc();
      companyFindFirst.mockResolvedValueOnce(null);
      await expect(svc.enrichCompany('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws when no AI provider is configured', async () => {
      const { _resetEnvCacheForTests } = await import('../../config/env');
      _resetEnvCacheForTests();
      makeSvc();
      companyFindFirst.mockResolvedValueOnce({
        id: 'co-1', name: 'Alfa', vatNumber: 'RO1', city: 'București', country: 'RO', contacts: [],
      });
      await expect(svc.enrichCompany('co-1')).rejects.toThrow(/No AI provider configured/);
    });

    it('uses Anthropic when ANTHROPIC_API_KEY is set', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      const { _resetEnvCacheForTests } = await import('../../config/env');
      _resetEnvCacheForTests();
      makeSvc();
      companyFindFirst.mockResolvedValueOnce({
        id: 'co-1', name: 'Alfa', vatNumber: 'RO1', city: 'București', country: 'RO', contacts: [],
      });
      anthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            industryGuess: 'IT',
            companySizeEstimate: 'small',
            relationshipHealth: 'STRONG',
            keyTopics: ['cloud'],
            suggestedNextStep: 'Schedule a quarterly review',
            reasoning: 'Active engagement.',
          }),
        }],
      });
      const out = await svc.enrichCompany('co-1');
      expect(out.industryGuess).toBe('IT');
      expect(anthropicCreate).toHaveBeenCalledOnce();
      expect(geminiGenerate).not.toHaveBeenCalled();
    });

    it('falls back to Gemini when only GEMINI_API_KEY is set', async () => {
      process.env.GEMINI_API_KEY = 'fake-gemini';
      const { _resetEnvCacheForTests } = await import('../../config/env');
      _resetEnvCacheForTests();
      makeSvc();
      companyFindFirst.mockResolvedValueOnce({
        id: 'co-1', name: 'Alfa', vatNumber: 'RO1', city: 'București', country: 'RO', contacts: [],
      });
      geminiGenerate.mockResolvedValueOnce({
        text: JSON.stringify({
          industryGuess: 'Manufacturing',
          companySizeEstimate: 'medium',
          relationshipHealth: 'NEUTRAL',
          keyTopics: [],
          suggestedNextStep: 'Reach out',
          reasoning: 'OK.',
        }),
      });
      const out = await svc.enrichCompany('co-1');
      expect(out.industryGuess).toBe('Manufacturing');
      expect(geminiGenerate).toHaveBeenCalledOnce();
      expect(anthropicCreate).not.toHaveBeenCalled();
    });
  });

  describe('enrichContact', () => {
    it('throws NotFound when the contact does not exist', async () => {
      process.env.GEMINI_API_KEY = 'fake-key';
      const { _resetEnvCacheForTests } = await import('../../config/env');
      _resetEnvCacheForTests();
      makeSvc();
      contactFindFirst.mockResolvedValueOnce(null);
      await expect(svc.enrichContact('ghost')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns parsed enrichment when the AI provider responds', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
      const { _resetEnvCacheForTests } = await import('../../config/env');
      _resetEnvCacheForTests();
      makeSvc();
      contactFindFirst.mockResolvedValueOnce({
        id: 'c-1', firstName: 'Ion', lastName: 'Pop', jobTitle: 'CEO',
        email: 'ion@x.ro', phone: '+40700', createdAt: new Date(),
      });
      anthropicCreate.mockResolvedValueOnce({
        content: [{
          type: 'text',
          text: JSON.stringify({
            communicationStyle: 'formal',
            seniorityLevel: 'EXECUTIVE',
            topicsOfInterest: ['strategy'],
            preferredContactChannel: 'email',
            suggestedNextStep: 'Send executive summary',
            reasoning: 'C-level signals.',
          }),
        }],
      });
      const out = await svc.enrichContact('c-1');
      expect(out.seniorityLevel).toBe('EXECUTIVE');
    });
  });
});
