import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../../infra/queue/queue.module';
import { ImporterController } from './importer.controller';
import { ImporterService } from './importer.service';
import { ImportProcessor } from './import.processor';

/**
 * ImporterModule — GestCom CSV → Clients/Companies/Contacts.
 *
 * Pipeline (the WHOLE story is here so you don't have to chase 4 files):
 *
 *   1. ImporterController.upload()
 *      - Accepts multipart `file` + `?type=CLIENTS|COMPANIES|CONTACTS`
 *      - multer.memoryStorage() (NOT diskStorage — workers are remote)
 *      - Hands the buffer to ImporterService.enqueue()
 *
 *   2. ImporterService.enqueue()
 *      - Uploads bytes to MinIO at <tenantId>/imports/<uuid>-<fileName>
 *      - Creates ImportJob row (status=PENDING) with the storageKey
 *      - Adds a BullMQ job to the `import` queue (idempotent on jobId)
 *
 *   3. ImportProcessor.process()  ← runs in the BullMQ worker context
 *      - Marks job RUNNING
 *      - Downloads the CSV from MinIO via storage.getObjectAsString()
 *      - Papa.parse → array of {colName: cell} rows
 *      - Per row: gestcom-mapper.ts normalises RO/EN headers, then
 *        the row is upserted with dedup logic:
 *           CLIENTS:   skip if (lastName, firstName, phone|mobile) match
 *           COMPANIES: skip if vatNumber matches (or name if no VAT)
 *           CONTACTS:  skip if (lastName, firstName, email) match
 *      - Progress ticked every 25 rows so the dashboard isn't frozen
 *      - Final state: COMPLETED (or FAILED if zero succeeded)
 *
 * Where to look when something breaks:
 *   - "row 5 failed: Missing required name fields" → gestcom-mapper.ts header
 *     normalisation didn't match. Add the new header to the candidate list.
 *   - "Object not found in storage" → check MinIO bucket exists + worker
 *     can reach it (MINIO_ENDPOINT env var, especially in docker compose
 *     where the API uses `http://minio:9000` not `localhost`).
 *   - Job stuck in PENDING → BullMQ worker not booted, check Redis +
 *     QueueModule logs. The processor runs in the API process for now;
 *     when split into a separate worker, both must read the same Redis.
 */
@Module({
  imports: [AuthModule, QueueModule],
  controllers: [ImporterController],
  providers: [ImporterService, ImportProcessor],
})
export class ImporterModule {}
