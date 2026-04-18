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

  private async fetchRows(tenantId: string, entityType: ExportableEntity, filters?: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const where: Record<string, unknown> = { tenantId, deletedAt: null, ...filters };

    const delegates: Record<ExportableEntity, (tx: Parameters<Parameters<typeof this.prisma.runWithTenant>[1]>[0]) => Promise<Record<string, unknown>[]>> = {
      companies: (tx) => tx.company.findMany({ where, take: 50_000 }) as Promise<Record<string, unknown>[]>,
      contacts: (tx) => tx.contact.findMany({ where, take: 50_000 }) as Promise<Record<string, unknown>[]>,
      clients: (tx) => tx.client.findMany({ where, take: 50_000 }) as Promise<Record<string, unknown>[]>,
      deals: (tx) => tx.deal.findMany({ where: { tenantId, deletedAt: null }, take: 50_000 }) as Promise<Record<string, unknown>[]>,
      invoices: (tx) => tx.invoice.findMany({ where: { tenantId, deletedAt: null }, take: 50_000 }) as Promise<Record<string, unknown>[]>,
      quotes: (tx) => tx.quote.findMany({ where: { tenantId, deletedAt: null }, take: 50_000 }) as Promise<Record<string, unknown>[]>,
      activities: (tx) => tx.activity.findMany({ where: { tenantId }, take: 50_000 }) as Promise<Record<string, unknown>[]>,
    };

    return this.prisma.runWithTenant(tenantId, (tx) => delegates[entityType](tx));
  }

  private toCsv(rows: Record<string, unknown>[]): string {
    if (rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.join(','), ...rows.map((r) => headers.map((h) => escape(r[h])).join(','))];
    return lines.join('\n');
  }
}
