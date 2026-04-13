/**
 * EmbeddingService — generates OpenAI text-embedding-3-small vectors and
 * stores them back into the DB using raw SQL (pgvector Unsupported type).
 *
 * All update methods are fire-and-forget: callers do `void this.embed.updateXxx()`.
 * Errors are caught internally so they never blow up the main request path.
 *
 * When OPENAI_API_KEY is absent, all methods are no-ops — the app stays fully
 * functional without embeddings (semantic search just returns empty results).
 */
import { Injectable, Logger } from '@nestjs/common';
import OpenAI from 'openai';

import { loadEnv } from '../../config/env';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly client: OpenAI | null;
  private readonly model = 'text-embedding-3-small';
  private readonly dims = 1536;

  constructor(private readonly prisma: PrismaService) {
    const { OPENAI_API_KEY } = loadEnv();
    this.client = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
    if (!this.client) {
      this.logger.warn('OPENAI_API_KEY not set — semantic search disabled');
    }
  }

  // ── embed helpers ─────────────────────────────────────────────────────────

  /** @internal — exposed for SearchService use */
  async embed(text: string): Promise<number[] | null> {
    if (!this.client) return null;
    try {
      const res = await this.client.embeddings.create({
        model: this.model,
        input: text.slice(0, 8192),
        dimensions: this.dims,
      });
      return res.data[0].embedding;
    } catch (err) {
      this.logger.error('OpenAI embed error: %o', err);
      return null;
    }
  }

  /** @internal — exposed for SearchService use */
  toVectorLiteral(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }

  // ── public update methods (fire-and-forget from entity services) ──────────

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

  // ── reindex — called by /ai/reindex admin endpoint ────────────────────────

  async reindexAll(): Promise<{ companies: number; contacts: number; clients: number }> {
    if (!this.client) return { companies: 0, contacts: 0, clients: 0 };
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
