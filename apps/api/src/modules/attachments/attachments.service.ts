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
    // Bind Content-Type into the presign signature so the browser is forced
    // to upload bytes matching the declared mime — uploading `text/html`
    // under an `application/pdf` presign now fails with 403 at MinIO.
    const uploadUrl = await this.storage.presignPut(storageKey, dto.mimeType);
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

    // Magic-byte / content-sniff validation: the client told us it was
    // uploading `application/pdf` — confirm by reading the first 4KB and
    // running `file-type` against the real bytes. Refuses e.g. HTML bytes
    // masquerading as PDFs (stored XSS vector via "save as" + rename).
    // Skipped for types that `file-type` cannot fingerprint reliably
    // (plain-text CSV, .txt — no magic bytes to check).
    const SNIFFABLE_MIMES = new Set([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/zip',
      'application/x-rar-compressed',
      'audio/mpeg',
      'audio/wav',
      'video/mp4',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    ]);
    if (SNIFFABLE_MIMES.has(dto.mimeType)) {
      try {
        const head = await this.storage.getObjectHead(dto.storageKey, 4100);
        // Lazy-import file-type (ESM-only) to avoid top-level CJS/ESM pain.
        const { fileTypeFromBuffer } = await import('file-type');
        const detected = await fileTypeFromBuffer(head);
        if (!detected || detected.mime !== dto.mimeType) {
          // Roll back — dangerous bytes don't stay in the bucket.
          await this.storage.remove(dto.storageKey);
          throw new BadRequestException({
            code: 'MIME_MISMATCH',
            message: `Uploaded file magic bytes (${detected?.mime ?? 'unknown'}) do not match declared mimeType ${dto.mimeType}`,
          });
        }
      } catch (err) {
        if (err instanceof BadRequestException) throw err;
        // file-type itself failed (corrupt stream etc.) — treat as mismatch.
        await this.storage.remove(dto.storageKey);
        throw new BadRequestException({
          code: 'MIME_CHECK_FAILED',
          message: 'Unable to verify uploaded file integrity',
        });
      }
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

  async list(
    subjectType: SubjectType,
    subjectId: string,
    opts: { latestOnly?: boolean } = {},
  ): Promise<Attachment[]> {
    await this.subjects.assertExists(subjectType, subjectId);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.attachment.findMany({
        where: {
          tenantId: ctx.tenantId,
          subjectType,
          subjectId,
          deletedAt: null,
          ...(opts.latestOnly ? { isLatest: true } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
    );
  }

  /**
   * List every version in the chain that `id` belongs to, newest first.
   * Walks the parentId link — `id` may be any version in the chain.
   */
  async listVersions(id: string): Promise<Attachment[]> {
    const anchor = await this.findOne(id);
    const ctx = requireTenantContext();
    const rootId = anchor.parentId ?? anchor.id;
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.attachment.findMany({
        where: {
          tenantId: ctx.tenantId,
          deletedAt: null,
          OR: [{ id: rootId }, { parentId: rootId }],
        },
        orderBy: [{ version: 'desc' }],
      }),
    );
  }

  /**
   * Upload a new version of an existing attachment. Caller already PUT
   * the new bytes to MinIO — we register the row, bump version, and flip
   * the old isLatest=true entry to false. parentId always points at the
   * root so the chain stays flat.
   */
  async createNewVersion(id: string, dto: CompleteAttachmentDto): Promise<Attachment> {
    const ctx = requireTenantContext();
    const anchor = await this.findOne(id);
    if (!dto.storageKey.startsWith(`${ctx.tenantId}/`)) {
      throw new BadRequestException({
        code: 'INVALID_STORAGE_KEY',
        message: 'storageKey does not belong to this tenant',
      });
    }
    const exists = await this.storage.exists(dto.storageKey);
    if (!exists) {
      throw new BadRequestException({
        code: 'UPLOAD_NOT_FOUND',
        message: 'Object not found in storage — did the PUT complete?',
      });
    }

    const rootId = anchor.parentId ?? anchor.id;

    const next = await this.prisma.runWithTenant(ctx.tenantId, async (tx) => {
      const agg = await tx.attachment.aggregate({
        where: {
          tenantId: ctx.tenantId,
          OR: [{ id: rootId }, { parentId: rootId }],
        },
        _max: { version: true },
      });
      const nextVersion = (agg._max.version ?? 1) + 1;
      await tx.attachment.updateMany({
        where: {
          tenantId: ctx.tenantId,
          OR: [{ id: rootId }, { parentId: rootId }],
        },
        data: { isLatest: false },
      });
      return tx.attachment.create({
        data: {
          tenantId: ctx.tenantId,
          subjectType: anchor.subjectType,
          subjectId: anchor.subjectId,
          storageKey: dto.storageKey,
          fileName: dto.fileName,
          mimeType: dto.mimeType,
          size: dto.size,
          uploadedById: ctx.userId,
          parentId: rootId,
          version: nextVersion,
          isLatest: true,
        },
      });
    });

    await this.audit.log({
      action: 'attachment.new_version',
      subjectType: anchor.subjectType.toLowerCase(),
      subjectId: anchor.subjectId,
      metadata: {
        attachmentId: next.id,
        rootId,
        version: next.version,
        fileName: dto.fileName,
      },
    });
    await this.activities.log({
      subjectType: anchor.subjectType,
      subjectId: anchor.subjectId,
      action: 'attachment.new_version',
      metadata: { attachmentId: next.id, rootId, version: next.version, fileName: dto.fileName },
    });

    return next;
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
    // Force Content-Disposition: attachment so browsers never render the file
    // inline (defense against XSS if a risky MIME ever makes it past the
    // whitelist, and against phishing via HTML/SVG preview).
    const downloadUrl = await this.storage.presignGet(a.storageKey, a.fileName);
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
