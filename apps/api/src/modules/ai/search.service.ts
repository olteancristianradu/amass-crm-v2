/**
 * SearchService — semantic search + similar-records via pgvector cosine distance.
 *
 * All queries use $queryRaw because the `embedding` column has Prisma type
 * Unsupported("vector(1536)") and cannot be accessed through the normal client.
 *
 * Similarity: 1 - cosine_distance (range 0..1). We return rows with score > 0.5.
 */
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { EmbeddingService } from './embedding.service';

export type EntityType = 'company' | 'contact' | 'client';

export interface SearchResult {
  id: string;
  type: EntityType;
  label: string;
  subtitle: string;
  score: number;
}

interface RawRow {
  id: string;
  label: string;
  subtitle: string;
  score: number;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
  ) {}

  /**
   * Multi-entity semantic search. Returns up to `limit` results across
   * companies + contacts + clients, ranked by cosine similarity.
   */
  async semanticSearch(query: string, limit = 10): Promise<SearchResult[]> {
    const { tenantId } = requireTenantContext();
    const vec = await this.embedding.embed(query);
    if (!vec) return [];
    const literal = this.embedding.toVectorLiteral(vec);

    const [companies, contacts, clients] = await Promise.all([
      this.prisma.$queryRaw<RawRow[]>`
        SELECT id,
               name                               AS label,
               COALESCE(industry, city, '')        AS subtitle,
               1 - (embedding <=> ${literal}::vector) AS score
        FROM companies
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> ${literal}::vector) > 0.5
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${limit}
      `,
      this.prisma.$queryRaw<RawRow[]>`
        SELECT id,
               first_name || ' ' || last_name      AS label,
               COALESCE(job_title, email, '')       AS subtitle,
               1 - (embedding <=> ${literal}::vector) AS score
        FROM contacts
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> ${literal}::vector) > 0.5
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${limit}
      `,
      this.prisma.$queryRaw<RawRow[]>`
        SELECT id,
               first_name || ' ' || last_name      AS label,
               COALESCE(email, city, '')            AS subtitle,
               1 - (embedding <=> ${literal}::vector) AS score
        FROM clients
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
          AND 1 - (embedding <=> ${literal}::vector) > 0.5
        ORDER BY embedding <=> ${literal}::vector
        LIMIT ${limit}
      `,
    ]);

    const results: SearchResult[] = [
      ...companies.map((r) => ({ ...r, type: 'company' as EntityType, score: Number(r.score) })),
      ...contacts.map((r) => ({ ...r, type: 'contact' as EntityType, score: Number(r.score) })),
      ...clients.map((r) => ({ ...r, type: 'client' as EntityType, score: Number(r.score) })),
    ];

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Find similar records of the same type as the given entity.
   * Uses the existing stored embedding — no fresh OpenAI call needed.
   */
  async findSimilar(type: EntityType, id: string, limit = 5): Promise<SearchResult[]> {
    const { tenantId } = requireTenantContext();

    if (type === 'company') {
      const rows = await this.prisma.$queryRaw<RawRow[]>`
        SELECT id,
               name                                AS label,
               COALESCE(industry, city, '')         AS subtitle,
               1 - (embedding <=> (
                 SELECT embedding FROM companies WHERE id = ${id}
               ))                                  AS score
        FROM companies
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
          AND id != ${id}
          AND (SELECT embedding FROM companies WHERE id = ${id}) IS NOT NULL
        ORDER BY embedding <=> (SELECT embedding FROM companies WHERE id = ${id})
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ ...r, type: 'company', score: Number(r.score) }));
    }

    if (type === 'contact') {
      const rows = await this.prisma.$queryRaw<RawRow[]>`
        SELECT id,
               first_name || ' ' || last_name       AS label,
               COALESCE(job_title, email, '')        AS subtitle,
               1 - (embedding <=> (
                 SELECT embedding FROM contacts WHERE id = ${id}
               ))                                   AS score
        FROM contacts
        WHERE tenant_id = ${tenantId}
          AND deleted_at IS NULL
          AND embedding IS NOT NULL
          AND id != ${id}
          AND (SELECT embedding FROM contacts WHERE id = ${id}) IS NOT NULL
        ORDER BY embedding <=> (SELECT embedding FROM contacts WHERE id = ${id})
        LIMIT ${limit}
      `;
      return rows.map((r) => ({ ...r, type: 'contact', score: Number(r.score) }));
    }

    // client
    const rows = await this.prisma.$queryRaw<RawRow[]>`
      SELECT id,
             first_name || ' ' || last_name         AS label,
             COALESCE(email, city, '')               AS subtitle,
             1 - (embedding <=> (
               SELECT embedding FROM clients WHERE id = ${id}
             ))                                     AS score
      FROM clients
      WHERE tenant_id = ${tenantId}
        AND deleted_at IS NULL
        AND embedding IS NOT NULL
        AND id != ${id}
        AND (SELECT embedding FROM clients WHERE id = ${id}) IS NOT NULL
      ORDER BY embedding <=> (SELECT embedding FROM clients WHERE id = ${id})
      LIMIT ${limit}
    `;
    return rows.map((r) => ({ ...r, type: 'client', score: Number(r.score) }));
  }
}
