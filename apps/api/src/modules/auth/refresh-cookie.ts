import { Request, Response } from 'express';

/**
 * M-10 — the refresh token lives in an httpOnly cookie so an XSS on the SPA
 * cannot exfiltrate it (contrast: if we stored it in localStorage, every XSS
 * = instant account takeover even after rotating the token).
 *
 * Why a dedicated helper instead of `cookie-parser`?
 *   - One file, zero new deps.
 *   - The grammar we need is trivial (one cookie name, URL-safe base64
 *     payload) — a full parser isn't warranted.
 *
 * Cookie attributes:
 *   - httpOnly:   JS cannot read it → no XSS exfiltration.
 *   - Secure:     only sent over HTTPS in production.
 *   - SameSite=Lax: cross-site subresource requests (image, script) don't
 *     get the cookie; top-level POSTs from other origins don't either,
 *     because login uses SPA fetch + CORS allow-list. Lax not Strict so
 *     that the initial `/` GET after a refresh link click still keeps
 *     the session.
 *   - Path=/api/v1/auth/: cookie is ONLY sent to auth endpoints. All other
 *     API calls bear the access token in Authorization header.
 *   - maxAge:     matches refresh-token TTL.
 */
export const REFRESH_COOKIE_NAME = 'amass_rt';

export function setRefreshCookie(res: Response, token: string, ttlSeconds: number, isProd: boolean): void {
  const parts: string[] = [
    `${REFRESH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/v1/auth/',
    `Max-Age=${ttlSeconds}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearRefreshCookie(res: Response, isProd: boolean): void {
  const parts: string[] = [
    `${REFRESH_COOKIE_NAME}=`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/v1/auth/',
    'Max-Age=0',
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function readRefreshCookie(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const chunk of header.split(';')) {
    const eq = chunk.indexOf('=');
    if (eq < 0) continue;
    const name = chunk.slice(0, eq).trim();
    if (name !== REFRESH_COOKIE_NAME) continue;
    const value = chunk.slice(eq + 1).trim();
    if (!value) return undefined;
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
