import { z } from 'zod';

export const EntityTypeSchema = z.enum(['company', 'contact', 'client']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

export const SearchResultSchema = z.object({
  id: z.string(),
  type: EntityTypeSchema,
  label: z.string(),
  subtitle: z.string(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SemanticSearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
});
export type SemanticSearchResponse = z.infer<typeof SemanticSearchResponseSchema>;
