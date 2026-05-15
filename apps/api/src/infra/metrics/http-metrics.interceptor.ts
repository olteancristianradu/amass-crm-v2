/**
 * HttpMetricsInterceptor — global Nest interceptor that records request
 * duration in the http_request_duration_seconds histogram on every HTTP
 * call (success + error). Wired in main.ts via app.useGlobalInterceptors.
 *
 * Route template extraction: we read `req.route?.path` which Express sets
 * to the matched route template AFTER routing (e.g. `/deals/:id`, never
 * `/deals/abc123`). If routing fails (404 before match) we fall back to
 * `<unknown>` so cardinality stays bounded.
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import { BusinessMetricsService } from './business-metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: BusinessMetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { route?: { path?: string } }>();
    const res = http.getResponse<Response>();
    const method = req.method ?? 'UNKNOWN';
    const start = process.hrtime.bigint();

    const finalize = (statusOverride?: number): void => {
      const durationNs = Number(process.hrtime.bigint() - start);
      const durationSec = durationNs / 1e9;
      // Route template is only available after the handler ran. For
      // exceptions thrown before routing (rare with Nest) we fall back.
      const route = req.route?.path ?? '<unknown>';
      const status = statusOverride ?? res.statusCode ?? 0;
      this.metrics.observeHttpRequest(method, route, status, durationSec);
    };

    return next.handle().pipe(
      tap({
        next: () => finalize(),
        // tap.error fires for error paths too, but Nest pipes them
        // through `catchError` first so we use that for the error branch
        // and let `next` cover success.
      }),
      catchError((err: unknown) => {
        // Best-effort status derivation: Nest's HttpException carries a
        // status; everything else is a 500.
        const status =
          err && typeof err === 'object' && 'getStatus' in err
            ? (err as { getStatus: () => number }).getStatus()
            : 500;
        finalize(status);
        return throwError(() => err);
      }),
    );
  }
}
