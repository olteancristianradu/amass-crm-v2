import { z } from 'zod';

export const LeadScoringEntityTypeSchema = z.enum(['company', 'contact']);
export type LeadScoringEntityType = z.infer<typeof LeadScoringEntityTypeSchema>;

export const RecomputeLeadScoreSchema = z.object({
  entityType: LeadScoringEntityTypeSchema,
  entityId: z.string().min(1),
});
export type RecomputeLeadScoreDto = z.infer<typeof RecomputeLeadScoreSchema>;
