import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException } from '@nestjs/common';
import { CsrfHeaderMiddleware } from './csrf-header.middleware';

function mkReq(method: string, header: string | undefined): Parameters<CsrfHeaderMiddleware['use']>[0] {
  return {
    method,
    headers: header !== undefined ? { 'x-requested-with': header } : {},
  } as unknown as Parameters<CsrfHeaderMiddleware['use']>[0];
}

describe('CsrfHeaderMiddleware', () => {
  const mw = new CsrfHeaderMiddleware();
  const res = {} as Parameters<CsrfHeaderMiddleware['use']>[1];

  it('passes through GET without the header (idempotent, not CSRF risk)', () => {
    const next = vi.fn();
    mw.use(mkReq('GET', undefined), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects POST without X-Requested-With', () => {
    const next = vi.fn();
    expect(() => mw.use(mkReq('POST', undefined), res, next)).toThrow(ForbiddenException);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects POST with wrong X-Requested-With value', () => {
    const next = vi.fn();
    expect(() => mw.use(mkReq('POST', 'evil-site'), res, next)).toThrow(ForbiddenException);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts POST with X-Requested-With: amass-web', () => {
    const next = vi.fn();
    mw.use(mkReq('POST', 'amass-web'), res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(['PUT', 'PATCH', 'DELETE'])(
    'enforces the header on %s (all mutative verbs)',
    (method) => {
      expect(() => mw.use(mkReq(method, undefined), res, vi.fn())).toThrow(ForbiddenException);
    },
  );

  it('throws with stable error code for the FE to key off', () => {
    try {
      mw.use(mkReq('POST', undefined), res, vi.fn());
    } catch (e) {
      const err = e as ForbiddenException;
      const body = err.getResponse() as { code: string };
      expect(body.code).toBe('CSRF_HEADER_MISSING');
    }
  });
});
