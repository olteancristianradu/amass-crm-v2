import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ReportBuilderService } from './report-builder.service';

const mockRunWithTenant = vi.fn();
const mockPrisma = { runWithTenant: mockRunWithTenant } as any;

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

const validConfig = {
  columns: ['id', 'name', 'createdAt'],
  filters: [],
  orderDir: 'desc' as const,
  chartType: 'table' as const,
  limit: 100,
};

describe('ReportBuilderService', () => {
  let svc: ReportBuilderService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new ReportBuilderService(mockPrisma);
  });

  describe('createTemplate', () => {
    it('creates and returns a template', async () => {
      const tpl = { id: 'tpl-1', name: 'Test', entityType: 'COMPANY', config: validConfig };
      mockRunWithTenant.mockResolvedValue(tpl);

      const result = await svc.createTemplate({
        name: 'Test',
        entityType: 'COMPANY',
        config: validConfig,
        isShared: false,
      });

      expect(result).toBe(tpl);
    });
  });

  describe('runTemplate', () => {
    it('throws BadRequestException for invalid column', async () => {
      const tpl = {
        id: 'tpl-1',
        tenantId: 'tenant-1',
        entityType: 'COMPANY',
        deletedAt: null,
        config: { ...validConfig, columns: ['id', 'INJECTED_COLUMN'] },
      };
      mockRunWithTenant.mockResolvedValue(tpl);

      await expect(svc.runTemplate('tpl-1')).rejects.toThrow(BadRequestException);
    });

    it('rejects disallowed columns regardless of allowlist', async () => {
      const tpl = {
        id: 'tpl-1',
        tenantId: 'tenant-1',
        entityType: 'DEAL',
        deletedAt: null,
        config: { ...validConfig, columns: ['id', 'passwordHash'] }, // not in DEAL allowlist
      };
      mockRunWithTenant.mockResolvedValue(tpl);

      await expect(svc.runTemplate('tpl-1')).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateTemplate', () => {
    it('throws ForbiddenException when non-owner tries to update private template', async () => {
      const tpl = {
        id: 'tpl-1',
        isShared: false,
        createdById: 'other-user',
        tenantId: 'tenant-1',
        deletedAt: null,
      };
      mockRunWithTenant.mockResolvedValue(tpl);

      await expect(svc.updateTemplate('tpl-1', { name: 'New Name' })).rejects.toThrow(ForbiddenException);
    });
  });
});
