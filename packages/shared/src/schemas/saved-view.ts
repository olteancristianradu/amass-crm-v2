import { z } from 'zod';

/**
 * Saved view — per-user, per-resource snapshot of a list page's filters,
 * search query, and sort. Selecting a view re-applies its `filters` blob.
 *
 * `resource` is a free-form string instead of an enum so adding a new list
 * page (e.g. 'cases') doesn't require a schema migration. List pages decide
 * what they expect inside `filters`; the BE just passes the JSON through.
 */
export const SavedViewResourceSchema = z.enum([
  'companies',
  'contacts',
  'clients',
  'leads',
  'deals',
  'cases',
  'invoices',
  'quotes',
]);
export type SavedViewResource = z.infer<typeof SavedViewResourceSchema>;

export const CreateSavedViewSchema = z.object({
  resource: SavedViewResourceSchema,
  name: z.string().trim().min(1).max(80),
  filters: z.record(z.unknown()),
});
export type CreateSavedViewDto = z.infer<typeof CreateSavedViewSchema>;

export const UpdateSavedViewSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  filters: z.record(z.unknown()).optional(),
});
export type UpdateSavedViewDto = z.infer<typeof UpdateSavedViewSchema>;

export const ListSavedViewsQuerySchema = z.object({
  resource: SavedViewResourceSchema,
});
export type ListSavedViewsQueryDto = z.infer<typeof ListSavedViewsQuerySchema>;
