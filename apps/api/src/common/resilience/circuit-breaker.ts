/**
 * C-ops: Minimal circuit breaker used to wrap calls to flaky external APIs
 * (Twilio, Anthropic, OpenAI, Stripe, ANAF). A failure storm in one provider
 * shouldn't chain-fail every request thread that reaches for it; trip the
 * breaker instead and fail fast.
 *
 * Intentionally tiny — no deps, no timers, no half-open probe scheduling
 * beyond a single trial request after the cooldown. Swap in `cockatiel` or
 * `opossum` when we actually need the bells (retry budgets, bulkheads, etc.).
 *
 * States:
 *   closed    — happy path, calls pass through and count failures
 *   open      — rejects immediately until `resetAfterMs` has elapsed
 *   halfOpen  — one trial call; if it succeeds → closed, else → open
 */
export interface CircuitBreakerOptions {
  /** Consecutive failures before opening. */
  failureThreshold: number;
  /** Cooldown before transitioning open → halfOpen. */
  resetAfterMs: number;
  /** Human-readable name for logs/errors. */
  name: string;
}

type State = 'closed' | 'open' | 'halfOpen';

export class CircuitBreakerOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker "${name}" is open`);
    this.name = 'CircuitBreakerOpenError';
  }
}

export class CircuitBreaker {
  private state: State = 'closed';
  private failures = 0;
  private openedAt = 0;

  constructor(private readonly opts: CircuitBreakerOptions) {}

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt >= this.opts.resetAfterMs) {
        this.state = 'halfOpen';
      } else {
        throw new CircuitBreakerOpenError(this.opts.name);
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure(): void {
    this.failures++;
    if (this.state === 'halfOpen' || this.failures >= this.opts.failureThreshold) {
      this.state = 'open';
      this.openedAt = Date.now();
    }
  }

  /** Current state — exposed for /health/detailed. */
  getState(): { name: string; state: State; failures: number } {
    return { name: this.opts.name, state: this.state, failures: this.failures };
  }
}

/**
 * Registry of named breakers so the health endpoint can surface state and
 * tests can reset them. Callers use `getBreaker('twilio')` to share a single
 * instance across the process.
 */
const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(name: string, opts?: Partial<CircuitBreakerOptions>): CircuitBreaker {
  const existing = breakers.get(name);
  if (existing) return existing;
  const breaker = new CircuitBreaker({
    name,
    failureThreshold: opts?.failureThreshold ?? 5,
    resetAfterMs: opts?.resetAfterMs ?? 30_000,
  });
  breakers.set(name, breaker);
  return breaker;
}

export function listBreakers(): Array<ReturnType<CircuitBreaker['getState']>> {
  return Array.from(breakers.values()).map((b) => b.getState());
}

/** Test helper. */
export function resetBreakers(): void {
  breakers.clear();
}
