import { CallStatus } from '@prisma/client';

/**
 * M-12 — Pure helpers extracted from CallsService. Twilio protocol glue
 * (status mapping, TwiML strings, queue payload type) that has no DB or
 * Nest dependencies and can be unit-tested in isolation.
 */

/** Twilio lowercase status → our enum. */
export const TWILIO_STATUS_MAP: Partial<Record<string, CallStatus>> = {
  queued: 'QUEUED',
  initiated: 'QUEUED',
  ringing: 'RINGING',
  'in-progress': 'IN_PROGRESS',
  completed: 'COMPLETED',
  busy: 'BUSY',
  'no-answer': 'NO_ANSWER',
  failed: 'FAILED',
  canceled: 'CANCELED',
};

export function mapTwilioStatus(twilioStatus: string): CallStatus | undefined {
  return TWILIO_STATUS_MAP[twilioStatus.toLowerCase()];
}

/** Empty TwiML response — used when we just need to acknowledge a webhook. */
export const TWIML_EMPTY = `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

/** Inbound-call thank-you + hangup in Romanian. */
export const TWIML_INBOUND_THANK_YOU = `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="ro-RO">Apelul dvs. a fost înregistrat. Vă mulțumim.</Say><Hangup/></Response>`;

export interface AiCallJobPayload {
  callId: string;
  tenantId: string;
  recordingUrl: string;
  recordingSid: string;
}
