import { z } from 'zod';

export const ChatterSubjectTypeSchema = z.enum([
  'COMPANY', 'CONTACT', 'CLIENT', 'DEAL', 'LEAD', 'CASE', 'ORDER', 'PROJECT',
]);
export type ChatterSubjectTypeDto = z.infer<typeof ChatterSubjectTypeSchema>;

export const CreateChatterPostSchema = z.object({
  subjectType: ChatterSubjectTypeSchema,
  subjectId: z.string().min(1).max(64),
  body: z.string().trim().min(1).max(8000),
  mentions: z.array(z.string().min(1).max(64)).default([]),
});
export type CreateChatterPostDto = z.infer<typeof CreateChatterPostSchema>;

export const UpdateChatterPostSchema = z.object({
  body: z.string().trim().min(1).max(8000),
});
export type UpdateChatterPostDto = z.infer<typeof UpdateChatterPostSchema>;

export const ListChatterQuerySchema = z.object({
  subjectType: ChatterSubjectTypeSchema,
  subjectId: z.string().min(1).max(64),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListChatterQueryDto = z.infer<typeof ListChatterQuerySchema>;
