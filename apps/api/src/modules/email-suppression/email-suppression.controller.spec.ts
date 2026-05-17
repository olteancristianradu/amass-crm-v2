import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailSuppressionController } from './email-suppression.controller';
import { EmailSuppressionService } from './email-suppression.service';

/**
 * Controller-level shape tests. Roles/JwtAuthGuard metadata is asserted via
 * Reflect.getMetadata on the handlers — keeps this test deps-free while still
 * catching role-drift regressions (e.g. someone adds AGENT to the list).
 */
describe('EmailSuppressionController', () => {
  let svc: { list: ReturnType<typeof vi.fn>; add: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let ctrl: EmailSuppressionController;

  beforeEach(() => {
    svc = { list: vi.fn(), add: vi.fn(), remove: vi.fn() };
    ctrl = new EmailSuppressionController(svc as unknown as EmailSuppressionService);
  });

  it('GET delegates to service.list with the validated query', async () => {
    svc.list.mockResolvedValueOnce({ data: [], nextCursor: null });
    const out = await ctrl.list({ limit: 25 } as never);
    expect(out).toEqual({ data: [], nextCursor: null });
    expect(svc.list).toHaveBeenCalledWith({ limit: 25 });
  });

  it('POST delegates to service.add', async () => {
    svc.add.mockResolvedValueOnce({ id: 's-1' });
    const out = await ctrl.create({ email: 'a@x.ro', reason: 'MANUAL_ADD' } as never);
    expect(out).toEqual({ id: 's-1' });
    expect(svc.add).toHaveBeenCalled();
  });

  it('DELETE delegates to service.remove', async () => {
    svc.remove.mockResolvedValueOnce(undefined);
    await ctrl.remove('s-1');
    expect(svc.remove).toHaveBeenCalledWith('s-1');
  });

  it('GET handler restricts roles to OWNER/ADMIN/MANAGER', () => {
    // The Roles decorator stores its UserRole[] on the method via Reflect.
    const meta = Reflect.getMetadata('roles', ctrl.list) as string[] | undefined;
    expect(meta).toEqual(expect.arrayContaining(['OWNER', 'ADMIN', 'MANAGER']));
    expect(meta).not.toContain('AGENT');
    expect(meta).not.toContain('VIEWER');
  });

  it('POST handler restricts roles to OWNER/ADMIN', () => {
    const meta = Reflect.getMetadata('roles', ctrl.create) as string[] | undefined;
    expect(meta).toEqual(expect.arrayContaining(['OWNER', 'ADMIN']));
    expect(meta).not.toContain('MANAGER');
  });

  it('DELETE handler restricts roles to OWNER/ADMIN', () => {
    const meta = Reflect.getMetadata('roles', ctrl.remove) as string[] | undefined;
    expect(meta).toEqual(expect.arrayContaining(['OWNER', 'ADMIN']));
    expect(meta).not.toContain('MANAGER');
  });
});
