/**
 * EmbeddingService — generates 1536-dim text vectors and stores them in
 * the DB via raw SQL (pgvector Unsupported type).
 *
 * Provider priority:
 *   1. Google Gemini (gemini-embedding-001 @ outputDimensionality=1536) — FREE tier
 *   2. OpenAI (text-embedding-3-small) — paid fallback
 *   3. No-op — if neither key set, semantic search returns empty
 *
 * All update methods are fire-and-forget: callers do `void this.embed.updateXxx()`.
 * Errors are caught internally so they never blow up the main request path.
 */
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';

import { loadEnv } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { getBreaker } from '../../common/resilience/circuit-breaker';

type Provider = 'gemini' | 'openai' | 'none';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly openai: OpenAI | null;
  private readonly gemini: GoogleGenAI | null;
  private readonly provider: Provider;
  private readonly dims = 1536;

  constructor(private readonly prisma: PrismaService) {
    const { GEMINI_API_KEY, OPENAI_API_KEY } = loadEnv();
    this.gemini = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
    this.openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

    if (this.gemini) this.provider = 'gemini';
    else if (this.openai) this.provider = 'openai';
    else this.provider = 'none';

    if (this.provider === 'none') {
      this.logger.warn('Neither GEMINI_API_KEY nor OPENAI_API_KEY set — semantic search disabled');
    } else {
      this.logger.log(`EmbeddingService using provider=${this.provider}`);
    }
  }

  /** @internal — exposed for SearchService use */
  async embed(text: string): Promise<number[] | null> {
    if (this.provider === 'none') return null;
    const input = text.slice(0, 8192);
    try {
      if (this.provider === 'gemini' && this.gemini) {
        const gemini = this.gemini;
        const res = await getBreaker('gemini').exec(() =>
          gemini.models.embedContent({
            model: 'gemini-embedding-001',
            contents: [input],
            config: { outputDimensionality: this.dims },
          }),
        );
        const values = res.embeddings?.[0]?.values;
        return values ?? null;
      }
      if (this.provider === 'openai' && this.openai) {
        const openai = this.openai;
        const res = await getBreaker('openai').exec(() =>
          openai.embeddings.create({
            model: 'text-embedding-3-small',
            input,
            dimensions: this.dims,
          }),
        );
        return res.data[0].embedding;
      }
    } catch (err) {
      this.logger.error(`${this.provider} embed error: %o`, err);
    }
    return null;
  }

  /** @internal — exposed for SearchService use */
  toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }

  async updateCompany(id: string, text: string): Promise<void> {
    const vec = await this.embed(text);
    if (!vec) return;
    const literal = this.toVectorLiteral(vec);
    await this.prisma.$executeRaw`
      UPDATE companies SET embedding = ${literal}::vector WHERE id = ${id}
    `;
  }

  async updateContact(id: string, text: string): Promise<void> {
    const vec = await this.embed(text);
    if (!vec) return;
    const literal = this.toVectorLiteral(vec);
    await this.prisma.$executeRaw`
      UPDATE contacts SET embedding = ${literal}::vector WHERE id = ${id}
    `;
  }

  async updateClient(id: string, text: string): Promise<void> {
    const vec = await this.embed(text);
    if (!vec) return;
    const literal = this.toVectorLiteral(vec);
    await this.prisma.$executeRaw`
      UPDATE clients SET embedding = ${literal}::vector WHERE id = ${id}
    `;
  }

  async reindexAll(): Promise<{ companies: number; contacts: number; clients: number }> {
    if (this.provider === 'none') return { companies: 0, contacts: 0, clients: 0 };
    const { tenantId } = requireTenantContext();

    const [companies, contacts, clients] = await Promise.all([
      this.prisma.company.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, name: true, industry: true, city: true, notes: true },
      }),
      this.prisma.contact.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, notes: true },
      }),
      this.prisma.client.findMany({
        where: { tenantId, deletedAt: null },
        select: { id: true, firstName: true, lastName: true, email: true, city: true, notes: true },
      }),
    ]);

    let companyCount = 0;
    for (const c of companies) {
      const text = [c.name, c.industry, c.city, c.notes].filter(Boolean).join(' ');
      await this.updateCompany(c.id, text);
      companyCount++;
    }
    let contactCount = 0;
    for (const c of contacts) {
      const text = [c.firstName, c.lastName, c.jobTitle, c.email, c.notes].filter(Boolean).join(' ');
      await this.updateContact(c.id, text);
      contactCount++;
    }
    let clientCount = 0;
    for (const c of clients) {
      const text = [c.firstName, c.lastName, c.email, c.city, c.notes].filter(Boolean).join(' ');
      await this.updateClient(c.id, text);
      clientCount++;
    }

    return { companies: companyCount, contacts: contactCount, clients: clientCount };
  }
}
