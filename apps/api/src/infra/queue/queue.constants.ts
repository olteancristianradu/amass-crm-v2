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
