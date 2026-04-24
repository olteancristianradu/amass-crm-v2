import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

/**
 * Lightweight CSRF defence for cookie-authenticated mutative endpoints.
 *
 * Threat model: a POST/DELETE that relies solely on a cookie (our
 * `amass_rt` refresh cookie is the only one) is CSRF-vulnerable unless
 * we verify the request came from our own SPA. The cookie has
 * `SameSite=Lax + Path=/api/v1/auth/` which already blocks cross-site
 * subresource POSTs, but we add a second layer:
 *
 *   - Every mutative cookie-path request MUST carry
 *     `X-Requested-With: amass-web`. Browsers cannot send this custom
 *     header cross-origin without a CORS preflight, and our CORS policy
 *     only allows-listed origins (from CORS_ALLOWED_ORIGINS env).
 *     An attacker's site can't forge this header from a <form> submit
 *     or an <img> load — the two classic CSRF vectors.
 *
 * Double-submit cookie (csrf-csrf) is the other industry pattern but
 * adds FE plumbing (store + send on every mutative call). This header
 * check is strictly a subset of OWASP's "Custom Request Header" CSRF
 * defence and is recommended for SPAs with same-site cookies already.
 *
 * Applies to POST/DELETE/PATCH/PUT on the auth cookie path only.
 * GET is exempt (idempotent, not state-changing).
 */
@Injectable()
export class CsrfHeaderMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction): void {
    const mutative = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!mutative) return next();

    const header = req.headers['x-requested-with'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value !== 'amass-web') {
      throw new ForbiddenException({
        code: 'CSRF_HEADER_MISSING',
        message: 'X-Requested-With: amass-web header required on mutative cookie-authenticated requests',
      });
    }
    next();
  }
}
