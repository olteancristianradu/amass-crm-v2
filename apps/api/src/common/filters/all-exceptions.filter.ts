import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import { FxRateNotAvailableException } from '../../modules/fx-rates/fx-rate-not-available.exception';

interface ErrorResponseBody {
  code: string;
  message: string;
  details?: unknown;
  traceId: string;
  timestamp: string;
}

/**
 * B3-PR4 e2e finding: SCIM responses MUST follow RFC 7644 §3.12 error
 * envelope shape: `{ schemas: [...], detail: ..., status: ..., scimType?: ... }`.
 * The standard CRM envelope (above) is wrong shape for Okta/Azure parsers —
 * they reject any 4xx/5xx that doesn't include the schemas array. We detect
 * SCIM-bound requests by URL prefix and remap.
 */
function isScimRequest(url: string): boolean {
  return url.startsWith('/api/v1/scim/v2/') || url.startsWith('/scim/v2/');
}

interface ScimErrorBody {
  schemas: string[];
  detail: string;
  status: string;
  scimType?: string;
}

const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const traceId = (request.headers['x-trace-id'] as string | undefined) ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Unexpected error';
    let details: unknown;
    // B3-PR4: preserved through to the SCIM response body when the request
    // hits a /scim/v2/* route. RFC 7644 §3.12 defines values like
    // "invalidFilter", "tooMany", "uniqueness", "noTarget", etc.
    let scimType: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const r = res as Record<string, unknown>;
        message = (r.message as string | undefined) ?? (r.detail as string | undefined) ?? exception.message;
        code = (r.code as string | undefined) ?? code;
        details = r.details ?? r.errors;
        scimType = r.scimType as string | undefined;
      }
      // Default code mapping based on status if not explicitly set
      if (code === 'INTERNAL_ERROR') {
        code = HttpStatus[status] ?? 'HTTP_ERROR';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Don't leak internal error messages (Prisma stack traces, constraint
    // names, raw SQL) to the client on 5xx. The full message is still
    // logged + reported to Sentry below — the client just gets a generic
    // string they can quote alongside the traceId.
    const safeMessage = status >= 500 ? 'Internal server error' : message;

    const standardBody: ErrorResponseBody = {
      code,
      message: safeMessage,
      details: status >= 500 ? undefined : details,
      traceId,
      timestamp: new Date().toISOString(),
    };

    // Report unexpected 5xx errors to Sentry (not 4xx — those are expected)
    if (status >= 500 && exception instanceof Error) {
      Sentry.captureException(exception, { extra: { traceId, url: request.url, method: request.method } });
    }

    this.logger.error(
      `[${traceId}] ${request.method} ${request.url} → ${status} ${code}: ${message}`,
      exception instanceof Error ? exception.stack : undefined,
    );

    if (isScimRequest(request.url)) {
      // SCIM response envelope per RFC 7644 §3.12. Okta/Azure parsers
      // reject anything without the `schemas` field, so we re-shape.
      const scimBody: ScimErrorBody = {
        schemas: [SCIM_ERROR_SCHEMA],
        detail: safeMessage,
        status: String(status),
        ...(scimType ? { scimType } : {}),
      };
      response
        .status(status)
        .setHeader('Content-Type', 'application/scim+json')
        .json(scimBody);
      return;
    }

    // N-6: FX rate unavailability is transient (ECB cron will fill it on
    // next run). Surface Retry-After so well-behaved HTTP clients back off
    // rather than hammering.
    if (exception instanceof FxRateNotAvailableException) {
      response.setHeader('Retry-After', String(FxRateNotAvailableException.RETRY_AFTER_SECONDS));
    }

    response.status(status).json(standardBody);
  }
}
