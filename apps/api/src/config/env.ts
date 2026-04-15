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
});

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
  cached = parsed.data;
  return cached;
}
