import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus } from '@nestjs/common';
import { WebauthnController } from './webauthn.controller';
import type { WebauthnService } from './webauthn.service';

/**
 * WebauthnController is a thin pass-through to WebauthnService for the two
 * register routes; the two authenticate routes still throw 501 (B2-PR2).
 */

function makeSvc() {
  return {
    generateRegistrationOptions: vi.fn(),
    verifyRegistration: vi.fn(),
  };
}

function build(s: ReturnType<typeof makeSvc>) {
  return new WebauthnController(s as unknown as WebauthnService);
}

const fakeUser = {
  userId: 'u1',
  tenantId: 't1',
  email: 'a@x.ro',
  role: 'AGENT',
  jti: 'jti-1',
  exp: 1,
} as const;

describe('WebauthnController.registerOptions', () => {
  it('passes userId + tenantId from CurrentUser into the service', async () => {
    const svc = makeSvc();
    svc.generateRegistrationOptions.mockResolvedValue({ challenge: 'C' });
    const ctrl = build(svc);

    const r = await ctrl.registerOptions(fakeUser);

    expect(svc.generateRegistrationOptions).toHaveBeenCalledWith('u1', 't1');
    expect(r).toEqual({ challenge: 'C' });
  });
});

describe('WebauthnController.registerVerify', () => {
  it('forwards body.response + body.deviceName plus (userId, tenantId) to verifyRegistration', async () => {
    const svc = makeSvc();
    svc.verifyRegistration.mockResolvedValue({ passkeyId: 'pk1', credentialId: 'C1' });
    const ctrl = build(svc);

    const innerResponse = {
      id: 'CRED',
      rawId: 'CRED',
      type: 'public-key' as const,
      response: { clientDataJSON: 'CDJ', attestationObject: 'AO' },
    };
    const body = { response: innerResponse, deviceName: 'My iPhone' };

    const r = await ctrl.registerVerify(body as Parameters<typeof ctrl.registerVerify>[0], fakeUser);
    expect(svc.verifyRegistration).toHaveBeenCalledWith('u1', 't1', innerResponse, 'My iPhone');
    expect(r).toEqual({ passkeyId: 'pk1', credentialId: 'C1' });
  });
});

describe('WebauthnController authenticate stubs (still B2-PR2)', () => {
  it('POST authenticate/options still returns 501', () => {
    const ctrl = build(makeSvc());
    let thrown: unknown;
    try {
      ctrl.authenticateOptions();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
    expect((thrown as HttpException).getResponse()).toMatchObject({ code: 'WEBAUTHN_NOT_IMPLEMENTED' });
  });

  it('POST authenticate/verify still returns 501', () => {
    const ctrl = build(makeSvc());
    let thrown: unknown;
    try {
      ctrl.authenticateVerify();
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HttpException);
    expect((thrown as HttpException).getStatus()).toBe(HttpStatus.NOT_IMPLEMENTED);
  });
});
