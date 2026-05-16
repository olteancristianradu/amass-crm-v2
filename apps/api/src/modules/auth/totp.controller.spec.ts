import { describe, expect, it, vi } from 'vitest';
import { TotpController } from './totp.controller';
import type { TotpService } from './totp.service';

/**
 * TotpController: 3 endpoints (setup / enable / disable). Each is a thin
 * pass-through to TotpService. Tests pin the field-mapping so a future
 * refactor of the DTO names is caught here, not at runtime.
 */

function makeSvc() {
  return {
    beginSetup: vi.fn(),
    enable: vi.fn(),
    disable: vi.fn(),
  };
}

function build(s: ReturnType<typeof makeSvc>) {
  return new TotpController(s as unknown as TotpService);
}

const fakeUser = { userId: 'u1', tenantId: 't1', jti: 'jti-1', exp: 1 } as never;

describe('TotpController', () => {
  it('POST setup → beginSetup(userId, tenantId)', async () => {
    const svc = makeSvc();
    svc.beginSetup.mockResolvedValue({ otpAuthUrl: 'otpauth://...', secret: 'xxx' });
    const ctrl = build(svc);

    const r = await ctrl.setup(fakeUser);
    expect(svc.beginSetup).toHaveBeenCalledWith('u1', 't1');
    expect(r).toEqual({ otpAuthUrl: 'otpauth://...', secret: 'xxx' });
  });

  it('POST enable → enable(userId, tenantId, code) and returns success message + backup codes', async () => {
    const svc = makeSvc();
    svc.enable.mockResolvedValue({ backupCodes: ['aaaa1111', 'bbbb2222', 'cccc3333', 'dddd4444', 'eeee5555', 'ffff6666', 'gggg7777', 'hhhh8888', 'iiii9999', 'jjjj0000'] });
    const ctrl = build(svc);

    const r = await ctrl.enable({ code: '123456' }, fakeUser);
    expect(svc.enable).toHaveBeenCalledWith('u1', 't1', '123456');
    expect(r).toEqual({
      message: '2FA enabled successfully',
      backupCodes: ['aaaa1111', 'bbbb2222', 'cccc3333', 'dddd4444', 'eeee5555', 'ffff6666', 'gggg7777', 'hhhh8888', 'iiii9999', 'jjjj0000'],
    });
  });

  it('PATCH disable → disable(userId, tenantId, password) and returns success message', async () => {
    const svc = makeSvc();
    svc.disable.mockResolvedValue(undefined);
    const ctrl = build(svc);

    const r = await ctrl.disable({ password: 'CurrentP@ss1' }, fakeUser);
    expect(svc.disable).toHaveBeenCalledWith('u1', 't1', 'CurrentP@ss1');
    expect(r).toEqual({ message: '2FA disabled' });
  });
});
