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
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ImporterService } from './importer.service';

const UPLOAD_DIR = join(tmpdir(), 'amass-imports');
mkdirSync(UPLOAD_DIR, { recursive: true });

@Controller('imports')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ImporterController {
  constructor(private readonly importer: ImporterService) {}

  /**
   * Multipart upload: field name = `file`, plus a `type` query/body param.
   * Files land in OS temp dir under `amass-imports/`. After S6 these will
   * move to MinIO and `filePath` will become an object key.
   */
  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: UPLOAD_DIR,
        filename: (_req, file, cb) => {
          const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
          cb(null, `${randomUUID()}-${safe}`);
        },
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50MB cap
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
      filePath: file.path,
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
