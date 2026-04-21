import { z } from 'zod';

/**
 * Environment schema. Validated at startup — fail fast on missing required.
 * Adding a new env var? Add it here AND to .env.example.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be ≥16 chars'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be ≥16 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),

  REDIS_URL: z.string().url(),

  // MinIO / S3-compatible object storage. The endpoint must be reachable
  // from BOTH the API process and any client that follows a presigned URL,
  // so when the API runs on the host (default in dev) we want
  // http://localhost:9000, not http://minio:9000 (which is the docker-net
  // alias used when the API runs inside the same compose network).
  MINIO_ENDPOINT: z.string().url().default('http://localhost:9000'),
  MINIO_ACCESS_KEY: z.string().min(1).default('minioadmin'),
  MINIO_SECRET_KEY: z.string().min(1).default('minioadmin'),
  MINIO_BUCKET: z.string().min(1).default('amass-files'),

  // AES-256-GCM key for encrypting SMTP passwords at rest.
  // Must be exactly 32 bytes hex-encoded (64 hex chars).
  // Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
    .regex(/^[0-9a-fA-F]+$/, 'ENCRYPTION_KEY must be hex'),

  // Public base URL for the API itself. Used for building absolute tracking
  // URLs embedded in outbound emails (open pixel + click redirect). Falls
  // back to TWILIO_WEBHOOK_BASE_URL in dev if unset — they serve the same
  // purpose (a public-reachable URL pointing at this API).
  PUBLIC_API_BASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),

  // Twilio credentials + webhook base URL. The AUTH_TOKEN is used for
  // outbound REST calls AND for verifying inbound webhook signatures.
  // WEBHOOK_BASE_URL is the public URL Twilio can reach — in dev, this
  // is typically an ngrok/cloudflared tunnel; in prod, the real API host.
  TWILIO_ACCOUNT_SID: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  TWILIO_AUTH_TOKEN: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  TWILIO_WEBHOOK_BASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),

  // Anthropic API key for S13 AI worker (transcript summarisation).
  // Optional — empty string is treated as absent (no AI features).
  ANTHROPIC_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),

  // Static bearer token the Python AI worker uses to call back to the NestJS
  // API (POST /calls/:id/ai-result). Generate with:
  // node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  AI_WORKER_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16).optional(),
  ),

  // OpenAI key for text-embedding-3-small (S14 semantic search).
  // Optional — empty string is treated as absent (embeddings silently skipped).
  OPENAI_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),

  // Google Gemini API key — used as primary AI provider (free tier covers
  // embeddings + chat for typical SMB CRM workload). Get one free at
  // https://aistudio.google.com/app/apikey (no card required).
  // Falls back to OpenAI/Anthropic if unset.
  GEMINI_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),

  // Stripe secret key + webhook signing secret (S51 billing).
  // Optional — empty = billing features disabled.
  STRIPE_SECRET_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  STRIPE_WEBHOOK_SECRET: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),

  // Twilio SMS sender phone number (E.164, e.g. +40700000000). Optional.
  TWILIO_SMS_FROM: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),

  // Comma-separated list of origins allowed to call the API and open the
  // WebSocket gateway (e.g. "https://app.example.com,https://admin.example.com").
  // In dev, defaults to localhost Vite origins. Wildcard ('*') is only
  // allowed in non-production to prevent CSRF + websocket-hijacking.
  CORS_ALLOWED_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:4173,http://localhost:3000'),

  // Comma-separated CIDR/IP/substring list allowed to scrape /metrics.
  // Empty = require auth token. In dev defaults to localhost.
  METRICS_ALLOWED_IPS: z.string().default('127.0.0.1,::1,::ffff:127.0.0.1'),

  // Static bearer token to scrape /metrics when the request isn't from an
  // allowed IP. Generate with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  METRICS_AUTH_TOKEN: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(16).optional(),
  ),
});

/**
 * Extra rules that only apply in production. We don't want to block dev/test
 * with secrets that are fine to leave as placeholders locally.
 */
const prodOnlyChecks = (data: z.infer<typeof envSchema>): string[] => {
  const errors: string[] = [];

  // AI_WORKER_SECRET is required in prod — the Python worker authenticates
  // callbacks with it. Without it, any process can post fake AI results.
  if (!data.AI_WORKER_SECRET) {
    errors.push('AI_WORKER_SECRET must be set in production');
  }

  // Reject the default MinIO credentials from .env.example.
  if (data.MINIO_ACCESS_KEY === 'minioadmin' || data.MINIO_SECRET_KEY === 'minioadmin') {
    errors.push('MINIO_ACCESS_KEY/MINIO_SECRET_KEY must not be "minioadmin" in production');
  }

  // Reject the example ENCRYPTION_KEY (all zeros).
  if (data.ENCRYPTION_KEY === '0'.repeat(64)) {
    errors.push('ENCRYPTION_KEY must not be all-zeros in production');
  }

  // JWT secrets must be cryptographically strong (≥32 chars) in prod.
  if (data.JWT_SECRET.length < 32) {
    errors.push('JWT_SECRET must be ≥32 chars in production');
  }
  if (data.JWT_REFRESH_SECRET.length < 32) {
    errors.push('JWT_REFRESH_SECRET must be ≥32 chars in production');
  }

  // CORS wildcard is a CSRF + WS-hijacking risk — reject in prod.
  if (data.CORS_ALLOWED_ORIGINS.split(',').map((s) => s.trim()).includes('*')) {
    errors.push('CORS_ALLOWED_ORIGINS must not contain "*" in production');
  }

  // /metrics must be protected in production: either a non-empty IP allow-list
  // or an explicit bearer token.
  const metricsIps = data.METRICS_ALLOWED_IPS.split(',').map((s) => s.trim()).filter(Boolean);
  if (metricsIps.length === 0 && !data.METRICS_AUTH_TOKEN) {
    errors.push('METRICS_ALLOWED_IPS or METRICS_AUTH_TOKEN must be set in production');
  }

  return errors;
};

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // eslint-disable-next-line no-console
    console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
    throw new Error('Environment validation failed — see errors above.');
  }

  // Run production-only checks.
  if (parsed.data.NODE_ENV === 'production') {
    const prodErrors = prodOnlyChecks(parsed.data);
    if (prodErrors.length > 0) {
      // eslint-disable-next-line no-console
      console.error('❌ Production environment misconfiguration:', prodErrors);
      throw new Error('Production environment validation failed — see errors above.');
    }
  }

  cached = parsed.data;
  return cached;
}
