import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ApiError } from './api';

describe('ApiError', () => {
  it('accepts a string body (network-level failure)', () => {
    const err = new ApiError(500, 'Internal Server Error');
    expect(err.status).toBe(500);
    expect(err.code).toBe('HTTP_500');
    expect(err.message).toBe('Internal Server Error');
  });

  it('extracts code + message from a structured error envelope', () => {
    const err = new ApiError(404, {
      code: 'DEAL_NOT_FOUND',
      message: 'Deal not found',
      traceId: 't-123',
    });
    expect(err.code).toBe('DEAL_NOT_FOUND');
    expect(err.message).toBe('Deal not found');
    expect(err.traceId).toBe('t-123');
  });

  it('falls back to HTTP_<status> when code is missing', () => {
    const err = new ApiError(418, { message: "I'm a teapot" });
    expect(err.code).toBe('HTTP_418');
  });

  it('is an instance of Error so TanStack Query retry/onError picks it up', () => {
    const err = new ApiError(500, 'boom');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('ApiError');
  });
});

/**
 * api.get/post behaviour: prefixes /api/v1, attaches the token, and
 * translates 4xx/5xx into ApiError. We keep this light — a full round-trip
 * against MSW would drift with every new endpoint.
 */
describe('api client request shape', () => {
  beforeEach(() => {
    // Reset module-scoped auth state between tests by clearing fetch mock.
    vi.spyOn(window, 'fetch').mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prefixes /api/v1 on the URL', async () => {
    const fetchSpy = vi
      .spyOn(window, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
    const { api } = await import('./api');
    await api.get('/deals');
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/deals'),
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('throws ApiError on 404 with the server envelope', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'no' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { api } = await import('./api');
    await expect(api.get('/missing')).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('returns undefined for 204 No Content responses', async () => {
    vi.spyOn(window, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));
    const { api } = await import('./api');
    await expect(api.delete('/foo/1')).resolves.toBeUndefined();
  });
});
