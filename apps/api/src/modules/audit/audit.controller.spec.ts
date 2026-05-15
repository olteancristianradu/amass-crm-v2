import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AuditController } from './audit.controller';
import type { AuditService } from './audit.service';

/**
 * AuditController has a single endpoint guarded by RolesGuard (OWNER/ADMIN)
 * that parses the query with a Zod schema and forwards to AuditService.list.
 * These tests pin the parse + pagination defaults without standing up Nest.
 */

function makeSvc() {
  return {
    list: vi.fn(),
  } as unknown as AuditService & { list: ReturnType<typeof vi.fn> };
}

describe('AuditController', () => {
  it('forwards defaults (limit=50, no cursor, no action) when query is empty', async () => {
    const svc = makeSvc();
    svc.list.mockResolvedValue({ data: [], nextCursor: null });
    const ctrl = new AuditController(svc);

    const r = await ctrl.list({});
    expect(svc.list).toHaveBeenCalledWith({ cursor: undefined, limit: 50, action: undefined });
    expect(r).toEqual({ data: [], nextCursor: null });
  });

  it('coerces numeric limit + passes cursor and action filters through', async () => {
    const svc = makeSvc();
    svc.list.mockResolvedValue({ data: [{ id: 'a1' }], nextCursor: 'c2' });
    const ctrl = new AuditController(svc);

    await ctrl.list({ cursor: 'c1', limit: '25', action: 'user.login' });
    expect(svc.list).toHaveBeenCalledWith({ cursor: 'c1', limit: 25, action: 'user.login' });
  });

  it('rejects limit > 100 with INVALID_QUERY', async () => {
    const svc = makeSvc();
    const ctrl = new AuditController(svc);

    await expect(ctrl.list({ limit: '101' })).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.list).not.toHaveBeenCalled();
  });

  it('rejects non-numeric limit with INVALID_QUERY', async () => {
    const svc = makeSvc();
    const ctrl = new AuditController(svc);

    await expect(ctrl.list({ limit: 'abc' })).rejects.toBeInstanceOf(BadRequestException);
    expect(svc.list).not.toHaveBeenCalled();
  });
});
