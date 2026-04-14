/**
 * Stable BullMQ queue names. Keep these as constants so producers (services)
 * and consumers (processors) can never disagree on the spelling.
 */
export const QUEUE_IMPORT = 'import';
export const QUEUE_REMINDERS = 'reminders';
export const QUEUE_EMAIL = 'email';
export const QUEUE_AI_CALLS = 'ai-calls';
export const QUEUE_WORKFLOWS = 'workflow-runs';
