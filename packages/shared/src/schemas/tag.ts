import { z } from 'zod';

export const TagEntityTypeSchema = z.enum(['COMPANY', 'CONTACT', 'CLIENT', 'DEAL', 'LEAD']);
export type TagEntityType = z.infer<typeof TagEntityTypeSchema>;

export const CreateTagSchema = z.object({
  name: z.string().trim().min(1).max(100),
  color: z.string().trim().max(20).optional(),
});
export type CreateTagDto = z.infer<typeof CreateTagSchema>;

export const UpdateTagSchema = CreateTagSchema.partial();
export type UpdateTagDto = z.infer<typeof UpdateTagSchema>;

export const AssignTagSchema = z.object({
  entityType: TagEntityTypeSchema,
  entityId: z.string().min(1),
});
export type AssignTagDto = z.infer<typeof AssignTagSchema>;

export const ListTagsQuerySchema = z.object({
  entityType: TagEntityTypeSchema.optional(),
  entityId: z.string().optional(),
});
export type ListTagsQueryDto = z.infer<typeof ListTagsQuerySchema>;
