import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ImportType, Prisma } from '@prisma/client';
import Papa from 'papaparse';
import { sanitizeCsvRow } from '../../common/utils/csv-safe';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { QUEUE_IMPORT } from '../../infra/queue/queue.constants';
import {
  mapClientRow,
  mapCompanyRow,
  mapContactRow,
  RawRow,
} from './gestcom-mapper';
import type { ImportJobPayload } from './importer.service';

interface RowError {
  row: number;
  message: string;
}

/**
 * BullMQ worker that consumes import jobs. We deliberately read the entire
 * file into memory + Papa.parse it synchronously: GestCom exports rarely
 * exceed a few thousand rows, and chunked streaming complicates idempotency
 * tracking. If/when we hit large files, swap to Papa.parse(file, { step }).
 *
 * IDEMPOTENCY:
 *   - clients:   (tenantId, lastName, firstName, phone) — phone normalised
 *   - companies: (tenantId, vatNumber)  when present, else (tenantId, name)
 *   - contacts:  (tenantId, lastName, firstName, email)
 *
 * On duplicate we count it as `skipped`, not `failed` — re-running an
 * import must be safe.
 */
@Processor(QUEUE_IMPORT)
export class ImportProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<ImportJobPayload>): Promise<void> {
    const { jobId, tenantId, userId, type, storageKey } = job.data;
    this.logger.log(`Processing import jobId=${jobId} type=${type} key=${storageKey}`);

    // Mark RUNNING.
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: jobId },
        data: { status: 'RUNNING', startedAt: new Date() },
      }),
    );

    let rows: RawRow[] = [];
    try {
      // Fetch the file from MinIO. Workers may run on a different host
      // than the API, so we cannot rely on a local filesystem path.
      const csv = await this.storage.getObjectAsString(storageKey);
      const parsed = Papa.parse<RawRow>(csv, {
        header: true,
        skipEmptyLines: 'greedy',
        // Trim whitespace and BOM from headers — GestCom files often start
        // with a UTF-8 BOM that turns the first header into "\uFEFFNume".
        transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
      });
      if (parsed.errors.length > 0) {
        this.logger.warn(`Parse warnings: ${parsed.errors.length}`);
      }
      // CSV formula-injection defence: any cell starting with =/+/-/@/tab/CR
      // gets a leading tick so Excel/LibreOffice/Sheets treats it as text
      // when someone re-exports the data. See common/utils/csv-safe.ts.
      rows = parsed.data.map((r) => sanitizeCsvRow(r as Record<string, unknown>)) as RawRow[];
    } catch (err) {
      await this.markFailed(tenantId, jobId, [
        { row: 0, message: `Failed to parse file: ${(err as Error).message}` },
      ]);
      return;
    }

    const errors: RowError[] = [];
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
      const rowNo = i + 2; // header is row 1
      try {
        const result = await this.importRow(tenantId, userId, type, rows[i]);
        if (result === 'created') succeeded++;
        else if (result === 'skipped') skipped++;
      } catch (err) {
        failed++;
        const msg = (err as Error).message;
        if (errors.length < 50) errors.push({ row: rowNo, message: msg });
        this.logger.warn(`Row ${rowNo} failed: ${msg}`);
      }

      // Progress tick every 25 rows so the dashboard stays responsive.
      if (i % 25 === 0) {
        await this.prisma.runWithTenant(tenantId, (tx) =>
          tx.importJob.update({
            where: { id: jobId },
            data: { processed: i + 1, succeeded, failed, skipped },
          }),
        );
      }
    }

    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: jobId },
        data: {
          status: failed > 0 && succeeded === 0 ? 'FAILED' : 'COMPLETED',
          totalRows: rows.length,
          processed: rows.length,
          succeeded,
          failed,
          skipped,
          errors: errors.length > 0 ? (errors as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
          finishedAt: new Date(),
        },
      }),
    );

    this.logger.log(
      `Done jobId=${jobId} total=${rows.length} ok=${succeeded} skipped=${skipped} failed=${failed}`,
    );
  }

  private async importRow(
    tenantId: string,
    userId: string | undefined,
    type: ImportType,
    row: RawRow,
  ): Promise<'created' | 'skipped'> {
    if (type === 'CLIENTS') {
      const m = mapClientRow(row);
      if (!m) throw new Error('Missing required name fields');
      return this.prisma.runWithTenant(tenantId, async (tx) => {
        const phoneKey = (m.phone ?? m.mobile ?? '').replace(/\s+/g, '');
        const existing = await tx.client.findFirst({
          where: {
            tenantId,
            firstName: m.firstName,
            lastName: m.lastName,
            ...(phoneKey ? { OR: [{ phone: phoneKey }, { mobile: phoneKey }] } : {}),
          },
        });
        if (existing) return 'skipped' as const;
        await tx.client.create({
          data: { ...m, tenantId, createdById: userId },
        });
        return 'created' as const;
      });
    }

    if (type === 'COMPANIES') {
      const m = mapCompanyRow(row);
      if (!m) throw new Error('Missing company name');
      return this.prisma.runWithTenant(tenantId, async (tx) => {
        const existing = await tx.company.findFirst({
          where: m.vatNumber
            ? { tenantId, vatNumber: m.vatNumber }
            : { tenantId, name: m.name },
        });
        if (existing) return 'skipped' as const;
        await tx.company.create({
          data: { ...m, tenantId, createdById: userId },
        });
        return 'created' as const;
      });
    }

    // CONTACTS
    const m = mapContactRow(row);
    if (!m) throw new Error('Missing required name fields');
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.contact.findFirst({
        where: {
          tenantId,
          firstName: m.firstName,
          lastName: m.lastName,
          ...(m.email ? { email: m.email } : {}),
        },
      });
      if (existing) return 'skipped' as const;
      // Optional: link to a company by name (create-if-missing).
      let companyId: string | null = null;
      if (m.companyName) {
        const co = await tx.company.findFirst({
          where: { tenantId, name: m.companyName },
        });
        companyId = co?.id ?? null;
      }
      await tx.contact.create({
        data: {
          tenantId,
          firstName: m.firstName,
          lastName: m.lastName,
          jobTitle: m.jobTitle,
          email: m.email,
          phone: m.phone,
          mobile: m.mobile,
          companyId,
          createdById: userId,
        },
      });
      return 'created' as const;
    });
  }

  private async markFailed(tenantId: string, jobId: string, errors: RowError[]): Promise<void> {
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.importJob.update({
        where: { id: jobId },
        data: {
          status: 'FAILED',
          errors: errors as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      }),
    );
  }
}
