import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  CircuitBreaker,
  CircuitBreakerOpenError,
  getBreaker,
  listBreakers,
  resetBreakers,
} from './circuit-breaker';

describe('CircuitBreaker', () => {
  beforeEach(() => resetBreakers());

  it('passes through successful calls and keeps state closed', async () => {
    const b = new CircuitBreaker({ name: 'ok', failureThreshold: 3, resetAfterMs: 1000 });
    expect(await b.exec(() => Promise.resolve(42))).toBe(42);
    expect(b.getState().state).toBe('closed');
    expect(b.getState().failures).toBe(0);
  });

  it('opens after N consecutive failures and rejects fast', async () => {
    const b = new CircuitBreaker({ name: 'fail', failureThreshold: 2, resetAfterMs: 1000 });
    await expect(b.exec(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(b.exec(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(b.getState().state).toBe('open');

    // Next call should fail fast without invoking the function.
    const spy = vi.fn(() => Promise.resolve('never'));
    await expect(b.exec(spy)).rejects.toBeInstanceOf(CircuitBreakerOpenError);
    expect(spy).not.toHaveBeenCalled();
  });

  it('transitions to halfOpen after cooldown, then closes on a successful trial', async () => {
    vi.useFakeTimers();
    try {
      const b = new CircuitBreaker({ name: 'recover', failureThreshold: 1, resetAfterMs: 100 });
      await expect(b.exec(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
      expect(b.getState().state).toBe('open');

      vi.advanceTimersByTime(101);
      // First call after cooldown is the halfOpen trial — succeeds → closed.
      expect(await b.exec(() => Promise.resolve('ok'))).toBe('ok');
      expect(b.getState().state).toBe('closed');
      expect(b.getState().failures).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-opens when the halfOpen trial fails', async () => {
    vi.useFakeTimers();
    try {
      const b = new CircuitBreaker({ name: 'reopen', failureThreshold: 1, resetAfterMs: 100 });
      await expect(b.exec(() => Promise.reject(new Error('x')))).rejects.toThrow('x');
      vi.advanceTimersByTime(101);
      await expect(b.exec(() => Promise.reject(new Error('y')))).rejects.toThrow('y');
      expect(b.getState().state).toBe('open');
    } finally {
      vi.useRealTimers();
    }
  });

  it('getBreaker registry returns the same instance for the same name', () => {
    const a = getBreaker('twilio');
    const b = getBreaker('twilio');
    expect(a).toBe(b);
    expect(listBreakers().map((x) => x.name)).toContain('twilio');
  });
});
