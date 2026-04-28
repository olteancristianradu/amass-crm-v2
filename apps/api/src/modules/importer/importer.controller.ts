import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportTypeSchema } from '@amass/shared';
import { UserRole } from '@prisma/client';
import { memoryStorage } from 'multer';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { ImporterService } from './importer.service';

/**
 * GestCom CSV importer.
 *
 * Upload pipeline:
 *   1. Browser sends multipart `file` to POST /imports?type=CLIENTS|COMPANIES|CONTACTS
 *   2. Multer buffers it in memory (50MB cap)
 *   3. Controller calls `importer.enqueue()` which:
 *      - uploads the bytes to MinIO at `<tenantId>/imports/<uuid>-<fileName>`
 *      - persists an ImportJob row (status PENDING)
 *      - enqueues a BullMQ job with the storageKey
 *   4. ImportProcessor (BullMQ worker, may run on a different host) downloads
 *      the file from MinIO and parses it row-by-row.
 *
 * Why memoryStorage instead of diskStorage:
 *   The previous implementation wrote uploads to OS tmpdir and the worker
 *   read them with readFileSync. That breaks the moment workers run on a
 *   different machine than the API (or after a container restart). MinIO
 *   is the single source of truth for binary blobs across all sprints.
 */
@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class ImporterController {
  constructor(private readonly importer: ImporterService) {}

  @Post()
  @RequireCedar({ action: 'import::create', resource: 'Import::*' })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB cap — raise if real GestCom exports get bigger
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Query('type') typeQuery: string | undefined,
  ) {
    if (!file) throw new BadRequestException({ code: 'FILE_REQUIRED', message: 'file is required' });
    const parsed = ImportTypeSchema.safeParse(typeQuery);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_TYPE',
        message: 'type must be CLIENTS|COMPANIES|CONTACTS',
      });
    }
    return this.importer.enqueue({
      type: parsed.data,
      fileName: file.originalname,
      mimeType: file.mimetype || 'text/csv',
      buffer: file.buffer,
    });
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list() {
    return this.importer.list(50);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.importer.findOne(id);
  }
}
