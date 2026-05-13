import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Stub Sentry so we can assert capture calls without touching the SDK.
vi.mock('@sentry/node', () => ({
  captureException: vi.fn(),
}));

import * as Sentry from '@sentry/node';
import { AllExceptionsFilter } from './all-exceptions.filter';

function build(traceId?: string) {
  const statusFn = vi.fn().mockReturnThis();
  const jsonFn = vi.fn();
  const response = { status: statusFn, json: jsonFn };
  const request = {
    headers: traceId ? { 'x-trace-id': traceId } : {},
    method: 'GET',
    url: '/api/v1/companies',
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { filter: new AllExceptionsFilter(), host, statusFn, jsonFn, response, request };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AllExceptionsFilter', () => {
  it('maps a NestJS BadRequestException to a 400 envelope', () => {
    const { filter, host, statusFn, jsonFn } = build('trace-123');
    filter.catch(
      new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: [{ path: 'email', code: 'invalid_string' }],
      }),
      host,
    );
    expect(statusFn).toHaveBeenCalledWith(400);
    const body = jsonFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(body).toMatchObject({
      code: 'VALIDATION_ERROR',
      message: 'Invalid request body',
      traceId: 'trace-123',
    });
    expect(body['timestamp']).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(body['details']).toEqual([{ path: 'email', code: 'invalid_string' }]);
  });

  it('generates a fresh traceId when none is provided by the request', () => {
    const { filter, host, jsonFn } = build();
    filter.catch(new BadRequestException('boom'), host);
    const body = jsonFn.mock.calls[0]![0] as { traceId: string };
    // UUID v4 shape (8-4-4-4-12 hex with version=4 nibble).
    expect(body.traceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('returns safe message + omits details on 5xx (prevents Prisma stack leak)', () => {
    const { filter, host, statusFn, jsonFn } = build('t-5xx');
    // Simulate a Prisma-style error escaping the service layer.
    const prismaError = new Error('Invalid `prisma.findUnique()` invocation:\n\nUnique constraint failed on the fields: (`tenantId`,`email`)');
    filter.catch(prismaError, host);

    expect(statusFn).toHaveBeenCalledWith(500);
    const body = jsonFn.mock.calls[0]![0] as Record<string, unknown>;
    // Critical: the actual Prisma error message must NOT leak to the client.
    expect(body['message']).toBe('Internal server error');
    expect(body['details']).toBeUndefined();
    expect(body['traceId']).toBe('t-5xx');
  });

  it('reports 5xx to Sentry with traceId + request metadata, never 4xx', () => {
    const { filter, host } = build('t-sentry');
    filter.catch(new Error('boom'), host);
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const call = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[1]).toMatchObject({
      extra: { traceId: 't-sentry', url: '/api/v1/companies', method: 'GET' },
    });

    // Now a 4xx — must not call Sentry again.
    vi.clearAllMocks();
    const second = build('t-4xx');
    second.filter.catch(new BadRequestException('nope'), second.host);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it('falls back to HttpStatus[N] for the error code when none is provided', () => {
    const { filter, host, jsonFn } = build();
    filter.catch(new HttpException('forbidden', HttpStatus.FORBIDDEN), host);
    const body = jsonFn.mock.calls[0]![0] as { code: string };
    expect(body.code).toBe('FORBIDDEN');
  });

  it('handles a thrown non-Error value (e.g. throw "string")', () => {
    const { filter, host, statusFn, jsonFn } = build();
    filter.catch('something weird', host);
    expect(statusFn).toHaveBeenCalledWith(500);
    const body = jsonFn.mock.calls[0]![0] as { message: string; code: string };
    expect(body.message).toBe('Internal server error');
    // Non-Error throws keep the default INTERNAL_ERROR code (the
    // HttpStatus[N] fallback only fires inside the HttpException branch).
    expect(body.code).toBe('INTERNAL_ERROR');
  });
});
