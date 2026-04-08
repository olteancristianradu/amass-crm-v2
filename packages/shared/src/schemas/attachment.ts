import { z } from 'zod';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB cap. Tune as needed.

/**
 * Step 1 — request a presigned PUT URL. The FE sends fileName + mimeType +
 * size BEFORE the bytes; the API replies with `{ storageKey, uploadUrl }`.
 */
export const PresignAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(256),
  mimeType: z.string().trim().min(1).max(128),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
});
export type PresignAttachmentDto = z.infer<typeof PresignAttachmentSchema>;

/**
 * Step 2 — after the FE has PUT the bytes to MinIO, it calls "complete"
 * with the same metadata + the storageKey from step 1. We verify the
 * object exists in the bucket and persist the metadata row.
 */
export const CompleteAttachmentSchema = z.object({
  storageKey: z.string().trim().min(1).max(512),
  fileName: z.string().trim().min(1).max(256),
  mimeType: z.string().trim().min(1).max(128),
  size: z.number().int().positive().max(MAX_FILE_SIZE),
});
export type CompleteAttachmentDto = z.infer<typeof CompleteAttachmentSchema>;
