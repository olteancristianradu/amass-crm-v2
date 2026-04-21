import { describe, expect, it } from 'vitest';
import {
  getRequestContext,
  getRequestId,
  newRequestId,
  runWithRequestId,
} from './request-context';

describe('request-context', () => {
  it('newRequestId returns a UUID v4 shape', () => {
    const id = newRequestId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('newRequestId is unique across calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newRequestId()));
    expect(ids.size).toBe(1000);
  });

  it('outside runWithRequestId, getRequestId returns undefined', () => {
    expect(getRequestId()).toBeUndefined();
    expect(getRequestContext()).toBeUndefined();
  });

  it('runWithRequestId exposes the id inside the callback', () => {
    const id = 'req_test_123';
    const observed = runWithRequestId(id, () => getRequestId());
    expect(observed).toBe(id);
  });

  it('context does not leak outside the callback', () => {
    runWithRequestId('req_outer', () => {
      expect(getRequestId()).toBe('req_outer');
    });
    expect(getRequestId()).toBeUndefined();
  });

  it('nested runs observe their own id', () => {
    runWithRequestId('outer', () => {
      expect(getRequestId()).toBe('outer');
      runWithRequestId('inner', () => {
        expect(getRequestId()).toBe('inner');
      });
      // ALS restores the parent context after the inner run.
      expect(getRequestId()).toBe('outer');
    });
  });

  it('context survives an async boundary', async () => {
    const result = await runWithRequestId('req_async', async () => {
      await new Promise((r) => setImmediate(r));
      return getRequestId();
    });
    expect(result).toBe('req_async');
  });
});
