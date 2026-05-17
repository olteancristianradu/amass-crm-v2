/**
 * Stable BullMQ queue names. Keep these as constants so producers (services)
 * and consumers (processors) can never disagree on the spelling.
 */
export const QUEUE_IMPORT = 'import';
export const QUEUE_REMINDERS = 'reminders';
export const QUEUE_EMAIL = 'email';
export const QUEUE_AI_CALLS = 'ai-calls';
export const QUEUE_WORKFLOWS = 'workflow-runs';
export const QUEUE_LEAD_SCORING = 'lead-scoring';
export const QUEUE_EXPORT = 'exports';
export const QUEUE_FX_RATES = 'fx-rates';

/**
 * Phase 1 F2 — campaign builder. Per-campaign dispatch orchestration. The
 * `email` queue stays unchanged for per-message SMTP sends; this queue
 * carries the higher-level "fan out N recipients respecting the per-tenant
 * 50/sec + burst 200 rate" job. Delayed jobs use a deterministic jobId
 * (`campaign-<id>`) so cancel/pause can locate them with `getJob`.
 */
export const QUEUE_CAMPAIGN_DISPATCH = 'campaign-dispatch';

/**
 * Phase 1 F3 — outbox pattern poller. A single repeat job ('drain') on this
 * queue ticks every 5s and dispatches PENDING OutboxEvent rows. Concurrency
 * is intentionally 1 so we never race two drainers fan-out the same row
 * twice (the row update from PENDING→PUBLISHED is the dedup boundary).
 */
export const QUEUE_OUTBOX_POLL = 'outbox-poll';

/**
 * Phase 1 F3 — per-(endpoint, event) webhook delivery worker. The outbox
 * poller enqueues one job per matching subscription so failed deliveries
 * to endpoint A don't block delivery to endpoint B. BullMQ attempts +
 * exponential backoff drive retries; on terminal failure the
 * WebhookDelivery row is marked deadLetter=true for admin replay.
 */
export const QUEUE_WEBHOOK_DELIVERY = 'webhook-delivery';

/**
 * Phase 1 F1 — daily GDPR PII anonymization for email_tracks rows.
 * Cron fans out one job at 03:00 Europe/Bucharest; the processor walks the
 * partial index `email_tracks_pii_pending_idx` in 1k-row batches,
 * nullifies ip_address + user_agent on rows older than 90 days, and stamps
 * pii_hashed_at. Mitigates T-MAIL-I-01 (long-term PII retention).
 */
export const QUEUE_EMAIL_TRACKS_PII = 'email-tracks-pii';
