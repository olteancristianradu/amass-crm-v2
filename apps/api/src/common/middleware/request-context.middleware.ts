import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { newRequestId, requestStorage } from '../context/request-context';

/**
 * M-2 — stamp every request with an X-Request-Id and store it in ALS.
 *
 * Precedence:
 *   1. If the caller (Caddy, a test, a downstream-internal request) already
 *      sent `X-Request-Id`, reuse it so traces chain across hops.
 *   2. Otherwise mint a fresh UUID v4.
 * The value is echoed on the response so the browser/DevTools can show it
 * to the user, and so curl users can copy it into a bug report.
 *
 * Must be applied BEFORE TenantContextMiddleware so tenant-scoped code sees
 * the id when it enqueues jobs.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = typeof req.headers['x-request-id'] === 'string'
      ? (req.headers['x-request-id'] as string).slice(0, 128)
      : undefined;
    const requestId = incoming && /^[A-Za-z0-9._\-+]+$/.test(incoming)
      ? incoming
      : newRequestId();
    res.setHeader('X-Request-Id', requestId);
    requestStorage.run({ requestId }, () => next());
  }
}
