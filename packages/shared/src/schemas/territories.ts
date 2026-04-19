import { z } from 'zod';

export const CreateTerritorySchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  counties: z.array(z.string().trim().min(1).max(40)).default([]),
  industries: z.array(z.string().trim().min(1).max(80)).default([]),
});
export type CreateTerritoryDto = z.infer<typeof CreateTerritorySchema>;

export const UpdateTerritorySchema = CreateTerritorySchema.partial();
export type UpdateTerritoryDto = z.infer<typeof UpdateTerritorySchema>;

export const AssignTerritorySchema = z.object({
  userId: z.string().min(1).max(64),
});
export type AssignTerritoryDto = z.infer<typeof AssignTerritorySchema>;
