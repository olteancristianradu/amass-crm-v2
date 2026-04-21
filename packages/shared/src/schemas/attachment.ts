import { z } from 'zod';

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB cap. Tune as needed.

/**
 * Whitelist of MIME types accepted by the attachments upload flow.
 *
 * Explicitly EXCLUDED (XSS / RCE / phishing risk):
 *   - text/html, application/xhtml+xml  — inline JS in the same origin
 *   - image/svg+xml                     — SVG can embed <script>
 *   - application/javascript, text/javascript, text/css
 *   - application/x-msdownload, application/x-msdos-program (.exe/.bat/.dll)
 *   - application/x-sh, application/x-httpd-php
 *
 * If a user genuinely needs to attach HTML or SVG, they should zip it first.
 */
export const SAFE_MIME_TYPES: readonly string[] = [
  // PDFs & documents
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/rtf',
  // Plain text / data
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/tab-separated-values',
  'application/json',
  'application/xml',
  'text/xml',
  // Images (NO svg)
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/tiff',
  'image/heic',
  'image/heif',
  // Audio (call recordings)
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/mp4',
  'audio/x-m4a',
  'audio/ogg',
  'audio/webm',
  'audio/flac',
  // Video (call recordings, screen captures)
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  // Archives
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/vnd.rar',
  'application/x-7z-compressed',
  'application/x-tar',
  'application/gzip',
  // Email
  'message/rfc822',
  'application/vnd.ms-outlook',
];

const safeMimeSet: ReadonlySet<string> = new Set(SAFE_MIME_TYPES);

export const MimeTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((m) => safeMimeSet.has(m.toLowerCase()), {
    message: 'Unsupported file type. Allowed: PDF, Office docs, images (no SVG), audio, video, archives.',
  });

/**
 * Step 1 — request a presigned PUT URL. The FE sends fileName + mimeType +
 * size BEFORE the bytes; the API replies with `{ storageKey, uploadUrl }`.
 */
export const PresignAttachmentSchema = z.object({
  fileName: z.string().trim().min(1).max(256),
  mimeType: MimeTypeSchema,
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
  mimeType: MimeTypeSchema,
  size: z.number().int().positive().max(MAX_FILE_SIZE),
});
export type CompleteAttachmentDto = z.infer<typeof CompleteAttachmentSchema>;
