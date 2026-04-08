import { z } from 'zod';

/**
 * GestCom (and similar XLSX/CSV exports) typically dump rows for one of three
 * entity types. We accept the type as a query/body field so the importer
 * knows how to map columns and which table to write to.
 */
export const ImportTypeSchema = z.enum(['CLIENTS', 'COMPANIES', 'CONTACTS']);
export type ImportTypeDto = z.infer<typeof ImportTypeSchema>;

export const ImportStatusSchema = z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']);
export type ImportStatusDto = z.infer<typeof ImportStatusSchema>;

/**
 * Body for `POST /imports` — only carries the entity type. The actual file
 * arrives via multipart (handled by FileInterceptor).
 */
export const CreateImportSchema = z.object({
  type: ImportTypeSchema,
});
export type CreateImportDto = z.infer<typeof CreateImportSchema>;
