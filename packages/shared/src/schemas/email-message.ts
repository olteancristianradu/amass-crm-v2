import { z } from 'zod';
import { CuidSchema } from './common';
import { SubjectTypeSchema } from './note';

/**
 * Email message schemas. Messages are polymorphic — attached to a Company,
 * Contact, or Client so they appear in the subject's timeline. The FE
 * composes an email and POSTs it; the API creates a QUEUED row and enqueues
 * a BullMQ job. The processor sends it via Nodemailer and flips the status.
 */

const emailAddr = z.string().trim().email().max(255);

export const SendEmailSchema = z.object({
  accountId: CuidSchema,
  subjectType: SubjectTypeSchema,
  subjectId: CuidSchema,
  toAddresses: z.array(emailAddr).min(1).max(50),
  ccAddresses: z.array(emailAddr).max(50).default([]),
  bccAddresses: z.array(emailAddr).max(50).default([]),
  subject: z.string().trim().min(1).max(500),
  bodyHtml: z.string().min(1).max(500_000), // generous limit for HTML emails
  bodyText: z.string().max(200_000).optional(),
});
export type SendEmailDto = z.infer<typeof SendEmailSchema>;

export const ListEmailsQuerySchema = z.object({
  subjectType: SubjectTypeSchema.optional(),
  subjectId: CuidSchema.optional(),
  accountId: CuidSchema.optional(),
  status: z.enum(['QUEUED', 'SENDING', 'SENT', 'FAILED']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListEmailsQueryDto = z.infer<typeof ListEmailsQuerySchema>;
