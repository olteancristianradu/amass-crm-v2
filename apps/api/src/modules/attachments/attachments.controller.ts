import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CompleteAttachmentDto,
  CompleteAttachmentSchema,
  PresignAttachmentDto,
  PresignAttachmentSchema,
  SubjectTypeDto,
  SubjectTypeSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AttachmentsService } from './attachments.service';

/**
 * Two-step upload pattern (per CLAUDE.md architecture mandate):
 *   1. POST /:subjectType/:subjectId/attachments/presign  → uploadUrl
 *   2. (FE PUTs the bytes directly to MinIO at uploadUrl)
 *   3. POST /:subjectType/:subjectId/attachments          → register row
 *
 * Downloads also go via presigned URLs:
 *   GET /attachments/:id/download                         → 15-min URL
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  private parseSubject(raw: string): SubjectTypeDto {
    return SubjectTypeSchema.parse(raw.toUpperCase());
  }

  @Post(':subjectType/:subjectId/attachments/presign')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  presign(
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
    @Body(new ZodValidationPipe(PresignAttachmentSchema)) dto: PresignAttachmentDto,
  ) {
    return this.attachments.presign(this.parseSubject(subjectType), subjectId, dto);
  }

  @Post(':subjectType/:subjectId/attachments')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  complete(
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
    @Body(new ZodValidationPipe(CompleteAttachmentSchema)) dto: CompleteAttachmentDto,
  ) {
    return this.attachments.complete(this.parseSubject(subjectType), subjectId, dto);
  }

  @Get(':subjectType/:subjectId/attachments')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
    @Query('latestOnly') latestOnly?: string,
  ) {
    return this.attachments.list(this.parseSubject(subjectType), subjectId, {
      latestOnly: latestOnly === 'true' || latestOnly === '1',
    });
  }

  @Get('attachments/:id/download')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  download(@Param('id') id: string) {
    return this.attachments.getDownloadUrl(id);
  }

  @Get('attachments/:id/versions')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  versions(@Param('id') id: string) {
    return this.attachments.listVersions(id);
  }

  @Post('attachments/:id/versions')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  newVersion(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CompleteAttachmentSchema)) dto: CompleteAttachmentDto,
  ) {
    return this.attachments.createNewVersion(id, dto);
  }

  @Delete('attachments/:id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  remove(@Param('id') id: string) {
    return this.attachments.remove(id);
  }
}
