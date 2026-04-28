/**
 * Data export — generates CSV for any entity type and stores it in MinIO.
 * Flow: POST /exports → creates DataExport(PENDING) → BullMQ job → processor
 *   reads DB rows → streams CSV → MinIO → updates DataExport(DONE) + presigned URL.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { QUEUE_EXPORT } from '../../infra/queue/queue.constants';

export type ExportableEntity = 'companies' | 'contacts' | 'clients' | 'deals' | 'invoices' | 'quotes' | 'activities';
const ALLOWED_ENTITIES = new Set<ExportableEntity>(['companies', 'contacts', 'clients', 'deals', 'invoices', 'quotes', 'activities']);

@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_EXPORT) private readonly queue: Queue,
  ) {}

  async requestExport(entityType: string, filters?: Record<string, unknown>) {
    if (!ALLOWED_ENTITIES.has(entityType as ExportableEntity)) {
      throw new BadRequestException(`Unsupported entity type: ${entityType}`);
    }
    const { tenantId, userId } = requireTenantContext();

    const exp = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.dataExport.create({
        data: {
          tenantId,
          requestedById: userId ?? null,
          entityType,
          filters: filters ? (filters as Prisma.InputJsonObject) : Prisma.DbNull,
          status: 'PENDING',
        },
      }),
    );

    await this.queue.add('generate-export', { tenantId, exportId: exp.id, entityType, filters }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      // M-aud-M10: keep at most 100 completed jobs and 100 failed (24h);
      // unbounded retention pollutes Redis memory in long-running deploys.
      removeOnComplete: { count: 100 },
      removeOnFail: { age: 86_400, count: 100 },
    });

    return exp;
  }

  async getExport(id: string) {
    const { tenantId } = requireTenantContext();
    const exp = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.dataExport.findFirst({ where: { id, tenantId } }),
    );
    if (!exp) throw new NotFoundException('Export not found');
    return exp;
  }

  async getDownloadUrl(id: string): Promise<{ url: string }> {
    const exp = await this.getExport(id);
    if (exp.status !== 'DONE' || !exp.storageKey) {
      throw new BadRequestException('Export not ready yet');
    }
    const url = await this.storage.presignGet(exp.storageKey);
    return { url };
  }

  async listExports() {
    const { tenantId, userId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.dataExport.findMany({
        where: { tenantId, requestedById: userId ?? undefined },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    );
  }

  /** Called by the BullMQ processor to run the actual export. */
  async executeExport(tenantId: string, exportId: string, entityType: ExportableEntity, filters?: Record<string, unknown>): Promise<void> {
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.dataExport.update({ where: { id: exportId }, data: { status: 'PROCESSING' } }),
    );

    try {
      const rows = await this.fetchRows(tenantId, entityType, filters);
      const csv = this.toCsv(rows);
      const storageKey = `exports/${tenantId}/${exportId}.csv`;

      const buf = Buffer.from(csv, 'utf8');
      await this.storage.putObject(storageKey, buf, 'text/csv');

      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.dataExport.update({
          where: { id: exportId },
          data: { status: 'DONE', storageKey, rowCount: rows.length, completedAt: new Date() },
        }),
      );
    } catch (err) {
      await this.prisma.runWithTenant(tenantId, (tx) =>
        tx.dataExport.update({
          where: { id: exportId },
          data: { status: 'FAILED', error: String(err), completedAt: new Date() },
        }),
      );
      throw err;
    }
  }

  /**
   * Fetch rows in cursor-based chunks of CHUNK_SIZE, up to MAX_EXPORT_ROWS.
   * Previously this issued a single `take: 50_000` query, which silently
   * truncated larger tenants and loaded up to ~50k rows into memory at once.
   * Chunked fetch bounds memory per page and makes progress linear so the
   * worker can be interrupted cleanly.
   */
  private async fetchRows(tenantId: string, entityType: ExportableEntity, filters?: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const CHUNK_SIZE = 2_000;
    const MAX_EXPORT_ROWS = 1_000_000;

    const tableWhere: Record<ExportableEntity, Record<string, unknown>> = {
      companies: { tenantId, deletedAt: null, ...(filters ?? {}) },
      contacts: { tenantId, deletedAt: null, ...(filters ?? {}) },
      clients: { tenantId, deletedAt: null, ...(filters ?? {}) },
      deals: { tenantId, deletedAt: null },
      invoices: { tenantId, deletedAt: null },
      quotes: { tenantId, deletedAt: null },
      activities: { tenantId },
    };
    const where = tableWhere[entityType];

    // After runWithTenant grew an (tenantId, mode, fn) overload the old
    // Parameters<Parameters<...>[1]>[0] trick resolves to `never`. Use the
    // Prisma-exported TransactionClient type directly — it's what runWithTenant
    // passes in regardless of overload.
    type TxClient = Prisma.TransactionClient;
    const page = async (
      tx: TxClient,
      cursor: string | null,
    ): Promise<Array<{ id: string } & Record<string, unknown>>> => {
      const args = {
        where,
        orderBy: [{ id: 'asc' as const }],
        take: CHUNK_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      };
      switch (entityType) {
        case 'companies': return tx.company.findMany(args) as Promise<Array<{ id: string } & Record<string, unknown>>>;
        case 'contacts': return tx.contact.findMany(args) as Promise<Array<{ id: string } & Record<string, unknown>>>;
        case 'clients': return tx.client.findMany(args) as Promise<Array<{ id: string } & Record<string, unknown>>>;
        case 'deals': return tx.deal.findMany(args) as Promise<Array<{ id: string } & Record<string, unknown>>>;
        case 'invoices': return tx.invoice.findMany(args) as Promise<Array<{ id: string } & Record<string, unknown>>>;
        case 'quotes': return tx.quote.findMany(args) as Promise<Array<{ id: string } & Record<string, unknown>>>;
        case 'activities': return tx.activity.findMany(args) as Promise<Array<{ id: string } & Record<string, unknown>>>;
      }
    };

    const all: Array<{ id: string } & Record<string, unknown>> = [];
    let cursor: string | null = null;
    while (all.length < MAX_EXPORT_ROWS) {
      const chunk: Array<{ id: string } & Record<string, unknown>> =
        await this.prisma.runWithTenant(tenantId, (tx) => page(tx, cursor));
      if (chunk.length === 0) break;
      all.push(...chunk);
      if (chunk.length < CHUNK_SIZE) break;
      cursor = chunk[chunk.length - 1].id;
    }
    return all;
  }

  private toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown): string => {
      let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      // CSV formula-injection defence on OUTPUT as well: prefix cells that
      // start with =/+/-/@/tab/CR with a single tick so spreadsheet apps
      // display them as text. Defense-in-depth with the importer's
      // sanitizer (a row that was stored before the sanitizer shipped
      // still comes out safe through this path).
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))];
    return lines.join('\n');
  }
}
