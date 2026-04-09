import { z } from 'zod';

/**
 * Pipelines + stages. Pipelines are (mostly) read-only from the FE in
 * S10 — they're seeded on tenant register with a sensible default. We
 * still expose the schemas so an admin UI can create/rename later.
 */
export const StageTypeSchema = z.enum(['OPEN', 'WON', 'LOST']);
export type StageTypeDto = z.infer<typeof StageTypeSchema>;

export const CreatePipelineStageSchema = z.object({
  name: z.string().trim().min(1).max(128),
  type: StageTypeSchema.default('OPEN'),
  order: z.number().int().min(0).max(9999).default(0),
  probability: z.number().int().min(0).max(100).default(0),
});
export type CreatePipelineStageDto = z.infer<typeof CreatePipelineStageSchema>;

export const CreatePipelineSchema = z.object({
  name: z.string().trim().min(1).max(128),
  description: z.string().trim().max(1000).optional(),
  isDefault: z.boolean().default(false),
  stages: z.array(CreatePipelineStageSchema).min(1).max(20),
});
export type CreatePipelineDto = z.infer<typeof CreatePipelineSchema>;

export const UpdatePipelineSchema = z.object({
  name: z.string().trim().min(1).max(128).optional(),
  description: z.string().trim().max(1000).optional(),
  isDefault: z.boolean().optional(),
});
export type UpdatePipelineDto = z.infer<typeof UpdatePipelineSchema>;
