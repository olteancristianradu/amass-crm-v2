import { z } from 'zod';

export const PaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().min(1).max(200).optional(),
});
export type PaginationDto = z.infer<typeof PaginationSchema>;

export const CuidSchema = z.string().min(1).max(64);
