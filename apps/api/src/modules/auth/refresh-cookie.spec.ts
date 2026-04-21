import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './refresh-cookie';

// Thin mock for the subset of Express Response we touch.
function makeRes(): { res: Response; setHeader: ReturnType<typeof vi.fn> } {
  const setHeader = vi.fn();
  return { res: { setHeader } as unknown as Response, setHeader };
}

function makeReq(cookieHeader: string | undefined): Request {
  return { headers: { cookie: cookieHeader } } as unknown as Request;
}

describe('setRefreshCookie', () => {
  it('sets the expected attributes in non-production', () => {
    const { res, setHeader } = makeRes();
    setRefreshCookie(res, 'tok_abc', 3600, false);
    expect(setHeader).toHaveBeenCalledTimes(1);
    const [name, value] = setHeader.mock.calls[0];
    expect(name).toBe('Set-Cookie');
    expect(value).toContain(`${REFRESH_COOKIE_NAME}=tok_abc`);
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Lax');
    expect(value).toContain('Path=/api/v1/auth/');
    expect(value).toContain('Max-Age=3600');
    expect(value).not.toContain('Secure');
  });

  it('adds Secure in production', () => {
    const { res, setHeader } = makeRes();
    setRefreshCookie(res, 'tok_abc', 3600, true);
    const value = setHeader.mock.calls[0][1] as string;
    expect(value).toContain('Secure');
  });

  it('percent-encodes token values that contain reserved chars', () => {
    const { res, setHeader } = makeRes();
    setRefreshCookie(res, 'a b;c=d', 3600, false);
    const value = setHeader.mock.calls[0][1] as string;
    expect(value).toContain(`${REFRESH_COOKIE_NAME}=a%20b%3Bc%3Dd`);
  });
});

describe('clearRefreshCookie', () => {
  it('emits Max-Age=0 with matching Path', () => {
    const { res, setHeader } = makeRes();
    clearRefreshCookie(res, false);
    const value = setHeader.mock.calls[0][1] as string;
    expect(value).toContain('Max-Age=0');
    expect(value).toContain('Path=/api/v1/auth/');
    expect(value).toContain('HttpOnly');
  });
});

describe('readRefreshCookie', () => {
  it('returns undefined when no cookie header is present', () => {
    expect(readRefreshCookie(makeReq(undefined))).toBeUndefined();
  });

  it('returns undefined when our cookie is absent', () => {
    expect(readRefreshCookie(makeReq('other=abc; foo=bar'))).toBeUndefined();
  });

  it('parses and decodes a simple value', () => {
    expect(readRefreshCookie(makeReq(`${REFRESH_COOKIE_NAME}=hello`))).toBe('hello');
  });

  it('decodes percent-encoded values', () => {
    expect(
      readRefreshCookie(makeReq(`${REFRESH_COOKIE_NAME}=a%20b%3Bc%3Dd`)),
    ).toBe('a b;c=d');
  });

  it('picks the right cookie out of a mixed string', () => {
    expect(
      readRefreshCookie(makeReq(`other=xxx; ${REFRESH_COOKIE_NAME}=tok; sess=1`)),
    ).toBe('tok');
  });

  it('returns undefined on a malformed URI-encoded value (rather than throwing)', () => {
    expect(readRefreshCookie(makeReq(`${REFRESH_COOKIE_NAME}=%E0%A4%A`))).toBeUndefined();
  });

  it('returns undefined for an empty value', () => {
    expect(readRefreshCookie(makeReq(`${REFRESH_COOKIE_NAME}=`))).toBeUndefined();
  });
});
