import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, NotFoundException } from '@nestjs/common';

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: vi.fn(() => ({ tenantId: 'tenant-1', userId: 'user-1' })),
}));

// file-type is dynamically imported inside complete(); stub the dynamic import.
vi.mock('file-type', () => ({
  fileTypeFromBuffer: vi.fn(),
}));

import { AttachmentsService } from './attachments.service';
import { fileTypeFromBuffer } from 'file-type';

function build() {
  const tx = {
    attachment: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
  };
  const prisma = {
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof AttachmentsService>[0];
  const storage = {
    presignPut: vi.fn().mockResolvedValue('https://s3/presign-PUT'),
    presignGet: vi.fn().mockResolvedValue('https://s3/presign-GET'),
    exists: vi.fn().mockResolvedValue(true),
    remove: vi.fn().mockResolvedValue(undefined),
    getObjectHead: vi.fn().mockResolvedValue(Buffer.from([0x25, 0x50, 0x44, 0x46])), // %PDF
  } as unknown as ConstructorParameters<typeof AttachmentsService>[1];
  const audit = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof AttachmentsService>[2];
  const activities = { log: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof AttachmentsService>[3];
  const subjects = { assertExists: vi.fn().mockResolvedValue(undefined) } as unknown as ConstructorParameters<typeof AttachmentsService>[4];
  const svc = new AttachmentsService(prisma, storage, audit, activities, subjects);
  return { svc, prisma, tx, storage, audit, activities, subjects };
}

describe('AttachmentsService.presign', () => {
  beforeEach(() => vi.clearAllMocks());

  it('builds tenant-prefixed key and binds Content-Type into the signature', async () => {
    const h = build();
    const out = await h.svc.presign('CONTACT', 'c-1', {
      fileName: 'document.PDF',
      mimeType: 'application/pdf',
      size: 1024,
    } as never);
    expect(out.storageKey.startsWith('tenant-1/CONTACT/c-1/')).toBe(true);
    expect(out.storageKey.endsWith('.pdf')).toBe(true);
    expect(vi.mocked(h.storage.presignPut)).toHaveBeenCalledWith(
      out.storageKey,
      'application/pdf',
    );
    expect(out.expiresIn).toBe(15 * 60);
  });

  it('strips dangerous chars from the extension', async () => {
    const h = build();
    const out = await h.svc.presign('CONTACT', 'c-1', {
      fileName: 'evil.<script>',
      mimeType: 'text/html',
      size: 100,
    } as never);
    // <script> in extension is sanitised; it stays as something safe like "" (empty)
    expect(/[<>]/.test(out.storageKey)).toBe(false);
  });
});

describe('AttachmentsService.complete — security gates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a storage key from another tenant', async () => {
    const h = build();
    await expect(
      h.svc.complete('CONTACT', 'c-1', {
        storageKey: 'tenant-XXX/CONTACT/c-1/abc.pdf',
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        size: 100,
      } as never),
    ).rejects.toThrow(BadRequestException);
    expect(h.tx.attachment.create).not.toHaveBeenCalled();
  });

  it('refuses when the upload is missing in MinIO', async () => {
    const h = build();
    vi.mocked(h.storage.exists).mockResolvedValueOnce(false);
    await expect(
      h.svc.complete('CONTACT', 'c-1', {
        storageKey: 'tenant-1/CONTACT/c-1/abc.pdf',
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        size: 100,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuses + rolls back when magic bytes do not match declared mimeType', async () => {
    const h = build();
    vi.mocked(fileTypeFromBuffer).mockResolvedValueOnce({
      mime: 'text/html',
      ext: 'html',
    } as never);
    await expect(
      h.svc.complete('CONTACT', 'c-1', {
        storageKey: 'tenant-1/CONTACT/c-1/abc.pdf',
        fileName: 'x.pdf',
        mimeType: 'application/pdf',
        size: 100,
      } as never),
    ).rejects.toThrow(BadRequestException);
    // Rolled back from MinIO
    expect(vi.mocked(h.storage.remove)).toHaveBeenCalledWith('tenant-1/CONTACT/c-1/abc.pdf');
  });

  it('skips magic-byte check for non-sniffable types (text/csv)', async () => {
    const h = build();
    h.tx.attachment.create.mockResolvedValueOnce({ id: 'att-1' });
    await h.svc.complete('CONTACT', 'c-1', {
      storageKey: 'tenant-1/CONTACT/c-1/abc.csv',
      fileName: 'x.csv',
      mimeType: 'text/csv',
      size: 100,
    } as never);
    expect(vi.mocked(fileTypeFromBuffer)).not.toHaveBeenCalled();
  });

  it('records attachment + audits + activity on the happy path', async () => {
    const h = build();
    vi.mocked(fileTypeFromBuffer).mockResolvedValueOnce({
      mime: 'application/pdf',
      ext: 'pdf',
    } as never);
    h.tx.attachment.create.mockResolvedValueOnce({ id: 'att-1' });
    await h.svc.complete('CONTACT', 'c-1', {
      storageKey: 'tenant-1/CONTACT/c-1/abc.pdf',
      fileName: 'x.pdf',
      mimeType: 'application/pdf',
      size: 100,
    } as never);
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attachment.create' }),
    );
    expect(h.activities.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'attachment.added' }),
    );
  });
});

describe('AttachmentsService.list / findOne / getDownloadUrl / remove', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list filters by latestOnly when requested', async () => {
    const h = build();
    h.tx.attachment.findMany.mockResolvedValueOnce([]);
    await h.svc.list('CONTACT', 'c-1', { latestOnly: true });
    const where = h.tx.attachment.findMany.mock.calls[0][0].where;
    expect(where.isLatest).toBe(true);
  });

  it('findOne throws ATTACHMENT_NOT_FOUND when missing', async () => {
    const h = build();
    h.tx.attachment.findFirst.mockResolvedValueOnce(null);
    await expect(h.svc.findOne('ghost')).rejects.toThrow(NotFoundException);
  });

  it('remove() soft-deletes + best-effort MinIO remove + audits', async () => {
    const h = build();
    h.tx.attachment.findFirst.mockResolvedValueOnce({
      id: 'att-1',
      storageKey: 'tenant-1/CONTACT/c-1/x.pdf',
      fileName: 'x.pdf',
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    });
    h.tx.attachment.update.mockResolvedValueOnce({ id: 'att-1' });
    await h.svc.remove('att-1');
    const data = h.tx.attachment.update.mock.calls[0][0].data;
    expect(data.deletedAt).toBeInstanceOf(Date);
    expect(vi.mocked(h.storage.remove)).toHaveBeenCalledWith('tenant-1/CONTACT/c-1/x.pdf');
  });
});

describe('AttachmentsService.createNewVersion', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects a cross-tenant storage key', async () => {
    const h = build();
    h.tx.attachment.findFirst.mockResolvedValueOnce({
      id: 'att-1',
      parentId: null,
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    });
    await expect(
      h.svc.createNewVersion('att-1', {
        storageKey: 'tenant-XXX/CONTACT/c-1/v2.pdf',
        fileName: 'v2.pdf',
        mimeType: 'application/pdf',
        size: 100,
      } as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('bumps version, flips isLatest=false on the chain, creates the new row with parentId=root', async () => {
    const h = build();
    h.tx.attachment.findFirst.mockResolvedValueOnce({
      id: 'att-1',
      parentId: null, // anchor IS the root
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    });
    h.tx.attachment.aggregate.mockResolvedValueOnce({ _max: { version: 1 } });
    h.tx.attachment.create.mockResolvedValueOnce({ id: 'att-2', version: 2 });
    await h.svc.createNewVersion('att-1', {
      storageKey: 'tenant-1/CONTACT/c-1/v2.pdf',
      fileName: 'v2.pdf',
      mimeType: 'application/pdf',
      size: 200,
    } as never);
    expect(h.tx.attachment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isLatest: false } }),
    );
    const created = h.tx.attachment.create.mock.calls[0][0].data;
    expect(created.parentId).toBe('att-1'); // root
    expect(created.version).toBe(2);
    expect(created.isLatest).toBe(true);
  });

  it('walks parentId to find the chain root when anchor is itself a child', async () => {
    const h = build();
    h.tx.attachment.findFirst.mockResolvedValueOnce({
      id: 'att-2',
      parentId: 'att-1', // root is att-1
      subjectType: 'CONTACT',
      subjectId: 'c-1',
    });
    h.tx.attachment.aggregate.mockResolvedValueOnce({ _max: { version: 2 } });
    h.tx.attachment.create.mockResolvedValueOnce({ id: 'att-3', version: 3 });
    await h.svc.createNewVersion('att-2', {
      storageKey: 'tenant-1/CONTACT/c-1/v3.pdf',
      fileName: 'v3.pdf',
      mimeType: 'application/pdf',
      size: 300,
    } as never);
    const created = h.tx.attachment.create.mock.calls[0][0].data;
    expect(created.parentId).toBe('att-1'); // chain stays flat
    expect(created.version).toBe(3);
  });
});
