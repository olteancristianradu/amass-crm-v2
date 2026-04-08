import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CompleteAttachmentDto, PresignAttachmentDto } from '@amass/shared';
import { Attachment, SubjectType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { StorageService } from '../../infra/storage/storage.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { ActivitiesService } from '../activities/activities.service';
import { AuditService } from '../audit/audit.service';
import { SubjectResolver } from '../activities/subject-resolver';

const PRESIGN_TTL_SECONDS = 15 * 60;

export interface PresignResult {
  storageKey: string;
  uploadUrl: string;
  expiresIn: number;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly activities: ActivitiesService,
    private readonly subjects: SubjectResolver,
  ) {}

  /**
   * Build a tenant-prefixed storage key. Layout:
   *   `<tenantId>/<subjectType>/<subjectId>/<uuid><ext>`
   *
   * The tenantId prefix means even if RLS in MinIO ever fails (it doesn't
   * have RLS), keys are namespaced — accidental cross-tenant key collisions
   * are impossible. We keep the original extension so MinIO content-type
   * inference and download UX work, but the basename is a uuid so we
   * never trust user input in object names.
   */
  private buildStorageKey(tenantId: string, subjectType: SubjectType, subjectId: string, fileName: string): string {
    const safeExt = extname(fileName).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 16);
    return `${tenantId}/${subjectType}/${subjectId}/${randomUUID()}${safeExt}`;
  }

  async presign(
    subjectType: SubjectType,
    subjectId: string,
    dto: PresignAttachmentDto,
  ): Promise<PresignResult> {
    await this.subjects.assertExists(subjectType, subjectId);
    const ctx = requireTenantContext();
    const storageKey = this.buildStorageKey(ctx.tenantId, subjectType, subjectId, dto.fileName);
    const uploadUrl = await this.storage.presignPut(storageKey);
    return { storageKey, uploadUrl, expiresIn: PRESIGN_TTL_SECONDS };
  }

  async complete(
    subjectType: SubjectType,
    subjectId: string,
    dto: CompleteAttachmentDto,
  ): Promise<Attachment> {
    await this.subjects.assertExists(subjectType, subjectId);
    const ctx = requireTenantContext();

    // Defense in depth: the storage key MUST be inside this tenant's prefix.
    // Without this, a malicious caller could pass another tenant's key from
    // a leaked presign and register it under their own subject.
    if (!dto.storageKey.startsWith(`${ctx.tenantId}/`)) {
      throw new BadRequestException({
        code: 'INVALID_STORAGE_KEY',
        message: 'storageKey does not belong to this tenant',
      });
    }

    // Verify the upload actually completed in MinIO.
    const exists = await this.storage.exists(dto.storageKey);
    if (!exists) {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Object not found in storage — did the PUT complete?',
      });
    }

    const attachment = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.attachment.create({
        data: {
          tenantId: ctx.tenantId,
          subjectType,
          subjectId,
          storageKey: dto.storageKey,
          fileName: dto.fileName,
          mimeType: dto.mimeType,
          size: dto.size,
          uploadedById: ctx.userId,
        },
      }),
    );

    await this.audit.log({
      action: 'attachment.create',
      subjectType: subjectType.toLowerCase(),
      subjectId,
      metadata: { attachmentId: attachment.id, fileName: dto.fileName, size: dto.size },
    });
    await this.activities.log({
      subjectType,
      subjectId,
      action: 'attachment.added',
      metadata: { attachmentId: attachment.id, fileName: dto.fileName, mimeType: dto.mimeType, size: dto.size },
    });

    return attachment;
  }

  async list(subjectType: SubjectType, subjectId: string): Promise<Attachment[]> {
    await this.subjects.assertExists(subjectType, subjectId);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.attachment.findMany({
        where: { tenantId: ctx.tenantId, subjectType, subjectId, deletedAt: null },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  }

  async findOne(id: string): Promise<Attachment> {
    const ctx = requireTenantContext();
    const a = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.attachment.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
      }),
    );
    if (!a) {
      throw new NotFoundException({ code: 'ATTACHMENT_NOT_FOUND', message: 'Attachment not found' });
    }
    return a;
  }

  async getDownloadUrl(id: string): Promise<{ downloadUrl: string; expiresIn: number; fileName: string; mimeType: string }> {
    const a = await this.findOne(id);
    const downloadUrl = await this.storage.presignGet(a.storageKey);
    return { downloadUrl, expiresIn: PRESIGN_TTL_SECONDS, fileName: a.fileName, mimeType: a.mimeType };
  }

  async remove(id: string): Promise<void> {
    const a = await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.attachment.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
    // Best-effort: remove from MinIO. If this fails the soft-delete still
    // hides the row from the API, and a periodic GC job (post-S18) will
    // sweep orphans.
    await this.storage.remove(a.storageKey);
    await this.audit.log({
      action: 'attachment.delete',
      subjectType: a.subjectType.toLowerCase(),
      subjectId: a.subjectId,
      metadata: { attachmentId: id, fileName: a.fileName },
    });
    await this.activities.log({
      subjectType: a.subjectType,
      subjectId: a.subjectId,
      action: 'attachment.deleted',
      metadata: { attachmentId: id, fileName: a.fileName },
    });
  }
}
