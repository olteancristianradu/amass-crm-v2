import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Phase 0 / Feature 2 — N-6 fix.
 *
 * Raised by FxRatesService.convert() / .lookup() when no rate row exists
 * for the requested pair ≤ asOf. We map this to HTTP 503 (not 404) because:
 *   - 404 leaks "no row exists" via the public endpoint, but more importantly,
 *   - the FE / internal caller can retry in a few minutes once the ECB cron
 *     fires, so 503 + Retry-After is the semantically correct shape.
 *
 * The AllExceptionsFilter picks up the `getResponse()` body shape and
 * inlines `code` / `message` / `details` exactly like any other HttpException;
 * the `Retry-After` header is set by the controller / interceptor that
 * surfaces this exception (see fx-rates.controller.ts response hook OR
 * the global filter override for this class).
 */
export class FxRateNotAvailableException extends HttpException {
  static readonly RETRY_AFTER_SECONDS = 3600;

  constructor(from: string, to: string, asOf?: Date) {
    super(
      {
        code: 'FX_RATE_NOT_AVAILABLE',
        message: `No exchange rate available for ${from}→${to}${
          asOf ? ` on or before ${asOf.toISOString().slice(0, 10)}` : ''
        }`,
        details: { from, to, retryAfterSeconds: FxRateNotAvailableException.RETRY_AFTER_SECONDS },
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
