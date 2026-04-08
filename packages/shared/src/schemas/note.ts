import { z } from 'zod';

/**
 * Polymorphic subject types — every notes/activities/attachments row
 * targets one of these. Mirrors the SubjectType enum in schema.prisma.
 */
export const SubjectTypeSchema = z.enum(['COMPANY', 'CONTACT', 'CLIENT']);
export type SubjectTypeDto = z.infer<typeof SubjectTypeSchema>;

export const CreateNoteSchema = z.object({
  body: z.string().trim().min(1).max(8000),
});
export type CreateNoteDto = z.infer<typeof CreateNoteSchema>;

export const UpdateNoteSchema = CreateNoteSchema.partial();
export type UpdateNoteDto = z.infer<typeof UpdateNoteSchema>;
