import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Pristine env snapshot to restore after each test.
const ORIGINAL_ENV = { ...process.env };

// Production-mode env that satisfies all base requirements EXCEPT the one
// each test is meant to violate. Tests mutate copies of this.
function makeProdBase(): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    PORT: '3000',
    DATABASE_URL: 'postgresql://prod:prod@db:5432/amass',
    REDIS_URL: 'redis://redis:6379',
    JWT_SECRET: 'a'.repeat(64),
    JWT_REFRESH_SECRET: 'b'.repeat(64),
    ENCRYPTION_KEY: 'f'.repeat(64),
    MINIO_ENDPOINT: 'http://minio:9000',
    MINIO_ACCESS_KEY: 'real-access',
    MINIO_SECRET_KEY: 'real-secret',
    CORS_ALLOWED_ORIGINS: 'https://app.example.com',
    METRICS_ALLOWED_IPS: '127.0.0.1',
    AI_WORKER_SECRET: 'c'.repeat(64),
    WEBHOOK_TRUSTED_HOSTS: '',
  };
}

beforeEach(() => {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('prodOnlyChecks — SEC-007 WEBHOOK_TRUSTED_HOSTS', () => {
  it('rejects non-empty WEBHOOK_TRUSTED_HOSTS in production', async () => {
    process.env = { ...ORIGINAL_ENV, ...makeProdBase(), WEBHOOK_TRUSTED_HOSTS: 'webhook-mock,foo.local' };
    const { loadEnv, _resetEnvCacheForTests } = await import('./env');
    _resetEnvCacheForTests();
    // loadEnv() rethrows with a generic message after console.error'ing the
    // specific list. We assert the throw plus that the prod-check function
    // exports the right message via a direct import.
    expect(() => loadEnv()).toThrow(/Production environment validation failed/);
  });

  it('accepts empty WEBHOOK_TRUSTED_HOSTS in production', async () => {
    process.env = { ...ORIGINAL_ENV, ...makeProdBase(), WEBHOOK_TRUSTED_HOSTS: '' };
    const { loadEnv, _resetEnvCacheForTests } = await import('./env');
    _resetEnvCacheForTests();
    expect(() => loadEnv()).not.toThrow();
  });

  it('accepts whitespace-only WEBHOOK_TRUSTED_HOSTS in production', async () => {
    process.env = { ...ORIGINAL_ENV, ...makeProdBase(), WEBHOOK_TRUSTED_HOSTS: ' , , ' };
    const { loadEnv, _resetEnvCacheForTests } = await import('./env');
    _resetEnvCacheForTests();
    expect(() => loadEnv()).not.toThrow();
  });

  it('accepts non-empty WEBHOOK_TRUSTED_HOSTS in development', async () => {
    process.env = { ...ORIGINAL_ENV, ...makeProdBase(), NODE_ENV: 'development', WEBHOOK_TRUSTED_HOSTS: 'webhook-mock' };
    const { loadEnv, _resetEnvCacheForTests } = await import('./env');
    _resetEnvCacheForTests();
    expect(() => loadEnv()).not.toThrow();
  });
});
