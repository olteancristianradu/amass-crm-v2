import { z } from 'zod';
import { CuidSchema } from './common';
import { SubjectTypeSchema } from './note';

/**
 * Call schemas. In S12 we support two flows:
 *  - OUTBOUND (click-to-call): FE posts to /calls/initiate with the subject
 *    + destination number. API creates a QUEUED Call row and asks Twilio to
 *    dial. Twilio webhooks update the row as the call progresses.
 *  - INBOUND: Twilio posts to /calls/webhook/voice when one of our numbers
 *    rings. We create a Call row and return TwiML (the Twilio response XML)
 *    routing the call to the assigned user.
 *
 * The status lifecycle is: QUEUED → RINGING → IN_PROGRESS → COMPLETED,
 * with BUSY/NO_ANSWER/FAILED/CANCELED as terminal error states.
 */

// E.164 format: + followed by 7-15 digits
const phoneNumberRegex = /^\+[1-9]\d{6,14}$/;
const phoneNumber = z.string().trim().regex(phoneNumberRegex, 'Phone must be E.164 format (+40712345678)');

export const CallDirectionSchema = z.enum(['INBOUND', 'OUTBOUND']);
export type CallDirectionDto = z.infer<typeof CallDirectionSchema>;

export const CallStatusSchema = z.enum([
  'QUEUED',
  'RINGING',
  'IN_PROGRESS',
  'COMPLETED',
  'BUSY',
  'NO_ANSWER',
  'FAILED',
  'CANCELED',
]);
export type CallStatusDto = z.infer<typeof CallStatusSchema>;

export const InitiateCallSchema = z.object({
  subjectType: SubjectTypeSchema,
  subjectId: CuidSchema,
  toNumber: phoneNumber,
  phoneNumberId: CuidSchema.optional(), // override default "from" number
});
export type InitiateCallDto = z.infer<typeof InitiateCallSchema>;

export const ListCallsQuerySchema = z.object({
  subjectType: SubjectTypeSchema.optional(),
  subjectId: CuidSchema.optional(),
  userId: CuidSchema.optional(),
  status: CallStatusSchema.optional(),
  direction: CallDirectionSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListCallsQueryDto = z.infer<typeof ListCallsQuerySchema>;

/**
 * Phone number (Twilio) CRUD. Numbers are usually purchased in the Twilio
 * console, not from the CRM — this endpoint just stores the mapping so the
 * CRM knows which numbers belong to which users.
 */
export const CreatePhoneNumberSchema = z.object({
  twilioSid: z.string().trim().min(1).max(64),
  number: phoneNumber,
  label: z.string().trim().max(100).optional(),
  userId: CuidSchema.optional(),
  isDefault: z.boolean().default(false),
});
export type CreatePhoneNumberDto = z.infer<typeof CreatePhoneNumberSchema>;

/**
 * Result payload posted by the S13 AI worker after processing a call
 * recording. Saved to the CallTranscript table. The AI worker authenticates
 * with a dedicated JWT that has tenantId=<callTenant> + role=SYSTEM.
 */
export const AiCallResultSchema = z.object({
  language: z.string().trim().max(16).optional(),
  rawText: z.string().min(1),
  segments: z.array(
    z.object({
      start: z.number().nonnegative(),
      end: z.number().nonnegative(),
      speaker: z.string().trim().max(64).optional(),
      text: z.string(),
    }),
  ),
  redactedText: z.string().optional(),
  summary: z.string().optional(),
  actionItems: z.array(z.string()).optional(),
  sentiment: z.enum(['positive', 'neutral', 'negative']).optional(),
  topics: z.array(z.string()).optional(),
  model: z.string().trim().max(64).optional(),
});
export type AiCallResultDto = z.infer<typeof AiCallResultSchema>;
