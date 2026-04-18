import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { ExportsService } from './exports.service';

const mockRunWithTenant = vi.fn();
const mockQueue = { add: vi.fn() } as any;
const mockStorage = { putObject: vi.fn(), presignGet: vi.fn() } as any;
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

describe('ExportsService', () => {
  let svc: ExportsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ExportsService(mockPrisma, mockStorage, mockQueue);
  });

  describe('requestExport', () => {
    it('throws BadRequestException for unsupported entity type', async () => {
      await expect(svc.requestExport('unicorns')).rejects.toThrow(BadRequestException);
    });

    it('creates a DataExport record and queues job for valid entity', async () => {
      const exp = { id: 'exp1', status: 'PENDING', entityType: 'companies' };
      mockRunWithTenant.mockResolvedValue(exp);
      mockQueue.add.mockResolvedValue({});

      const result = await svc.requestExport('companies');
      expect(result).toBe(exp);
      expect(mockQueue.add).toHaveBeenCalledWith('generate-export', expect.objectContaining({ entityType: 'companies' }), expect.any(Object));
    });
  });

  describe('toCsv (via executeExport)', () => {
    it('generates valid CSV with headers and rows', async () => {
      const rows = [{ id: '1', name: 'Test,Corp', city: 'Cluj' }];
      mockRunWithTenant
        .mockResolvedValueOnce({ id: 'exp1' }) // update PROCESSING
        .mockResolvedValueOnce(rows)           // fetchRows
        .mockResolvedValueOnce({});            // update DONE

      mockStorage.putObject.mockResolvedValue(undefined);

      await svc.executeExport('t1', 'exp1', 'companies');

      const putCall = (mockStorage.putObject as ReturnType<typeof vi.fn>).mock.calls[0];
      const csv = putCall[1].toString('utf8');
      expect(csv).toContain('id,name,city');
      expect(csv).toContain('"Test,Corp"'); // comma in value must be quoted
    });
  });

  describe('getDownloadUrl', () => {
    it('throws if export not DONE', async () => {
      const exp = { id: 'exp1', status: 'PENDING', storageKey: null };
      mockRunWithTenant.mockResolvedValue(exp);
      await expect(svc.getDownloadUrl('exp1')).rejects.toThrow(BadRequestException);
    });

    it('returns presigned URL when DONE', async () => {
      const exp = { id: 'exp1', status: 'DONE', storageKey: 'exports/t1/exp1.csv' };
      mockRunWithTenant.mockResolvedValue(exp);
      (mockStorage.presignGet as ReturnType<typeof vi.fn>).mockResolvedValue('https://minio/presigned');

      const result = await svc.getDownloadUrl('exp1');
      expect(result).toEqual({ url: 'https://minio/presigned' });
    });
  });
});
