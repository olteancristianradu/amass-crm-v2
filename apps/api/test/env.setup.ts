/**
 * Test environment setup.
 * Loads the root .env file (which uses Docker hostnames) and then overrides
 * the DB/Redis URLs to use localhost for host-side test runs.
 * Also provides fallback values for required vars that are intentionally
 * omitted from the root .env (e.g. ENCRYPTION_KEY for dev).
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

function loadDotenv(path: string): void {
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    // Don't override values already set (e.g. from CI environment)
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}

// Load root .env
loadDotenv(resolve(__dirname, '../../../.env'));

// Override Docker hostnames with localhost for host-side test runs
if (!process.env.DATABASE_URL || process.env.DATABASE_URL.includes('@postgres:')) {
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/amass_crm?schema=public';
}
if (!process.env.REDIS_URL || process.env.REDIS_URL === 'redis://redis:6379') {
  process.env.REDIS_URL = 'redis://localhost:6379';
}
if (!process.env.MINIO_ENDPOINT || process.env.MINIO_ENDPOINT.includes('minio:')) {
  process.env.MINIO_ENDPOINT = 'http://localhost:9000';
}

// Fallback values for required vars that may be absent in dev .env
process.env.ENCRYPTION_KEY ??= '0000000000000000000000000000000000000000000000000000000000000000';
process.env.JWT_SECRET ??= 'test-secret-at-least-16chars';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-16+chars';
