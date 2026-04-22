import { describe, expect, it } from 'vitest';
import { queryClient } from './queryClient';
import { ApiError } from './api';

/**
 * Guards against accidental regressions in the global retry policy:
 * user-visible 4xx statuses must NOT be retried (that just delays the
 * error UI). Transient failures get exactly one retry.
 */
describe('queryClient retry policy', () => {
  const retry = queryClient.getDefaultOptions().queries!.retry as (
    failureCount: number,
    error: unknown,
  ) => boolean;

  it('does not retry on ApiError 401', () => {
    expect(retry(0, new ApiError(401, 'unauthorized'))).toBe(false);
  });

  it('does not retry on ApiError 403', () => {
    expect(retry(0, new ApiError(403, 'forbidden'))).toBe(false);
  });

  it('does not retry on ApiError 404', () => {
    expect(retry(0, new ApiError(404, 'not found'))).toBe(false);
  });

  it('does not retry on ApiError 400', () => {
    expect(retry(0, new ApiError(400, 'bad input'))).toBe(false);
  });

  it('retries once on a transient network error', () => {
    const err = new Error('network down');
    expect(retry(0, err)).toBe(true);
    expect(retry(1, err)).toBe(false);
  });

  it('retries once on ApiError 5xx', () => {
    const err = new ApiError(503, 'upstream');
    expect(retry(0, err)).toBe(true);
    expect(retry(1, err)).toBe(false);
  });

  it('disables mutation retries entirely', () => {
    expect(queryClient.getDefaultOptions().mutations!.retry).toBe(false);
  });
});
