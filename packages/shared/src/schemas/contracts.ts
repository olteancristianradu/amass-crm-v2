import { z } from 'zod';

/**
 * S54 Contracts — legal agreements between the tenant and a Company.
 * The document itself is stored in MinIO; the DB holds only `storageKey`
 * plus structured metadata (dates, value, status).
 */

export const ContractStatusSchema = z.enum([
  'DRAFT',
  // Phase 2 F1 — ceremony issued, awaiting one or more signers.
  'PENDING_SIGNATURE',
  'ACTIVE',
  'EXPIRED',
  'TERMINATED',
  'RENEWED',
  // Phase 2 F1 — at least one signer refused OR ceremony expired with
  // no completed signatures.
  'DECLINED',
]);
export type ContractStatusDto = z.infer<typeof ContractStatusSchema>;

const decimalString = z
  .string()
  .trim()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'value must be a decimal with up to 2 fraction digits');

export const CreateContractSchema = z.object({
  companyId: z.string().min(1).max(64),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).optional(),
  value: decimalString.optional(),
  currency: z.string().trim().length(3).toUpperCase().default('RON'),
  status: ContractStatusSchema.optional(),
  signedAt: z.coerce.date().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  renewalDate: z.coerce.date().optional(),
  autoRenew: z.boolean().default(false),
  storageKey: z.string().trim().max(500).optional(),
});
export type CreateContractDto = z.infer<typeof CreateContractSchema>;

/**
 * CRIT-3 / HIGH-6 — the generic PATCH /contracts/:id endpoint deliberately
 * does NOT accept `status`, `signedAt`, `storageKey` (or `pdfHash`). Those
 * fields are owned exclusively by the e-sign ceremony lifecycle
 * (signing.service / ceremony.service). Allowing them here let a
 * MANAGER/ADMIN/OWNER rewrite a signed ACTIVE contract back to DRAFT, forge
 * `signedAt`, or re-point `storageKey` at an attacker-controlled MinIO
 * object post-signing. `.strict()` makes any such field a 400, not a silent
 * no-op, so callers get a clear signal.
 */
export const UpdateContractSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).nullable(),
    value: decimalString.nullable(),
    currency: z.string().trim().length(3).toUpperCase(),
    startDate: z.coerce.date().nullable(),
    endDate: z.coerce.date().nullable(),
    renewalDate: z.coerce.date().nullable(),
    autoRenew: z.boolean(),
  })
  .strict()
  .partial();
export type UpdateContractDto = z.infer<typeof UpdateContractSchema>;

export const ListContractsQuerySchema = z.object({
  companyId: z.string().min(1).max(64).optional(),
  status: ContractStatusSchema.optional(),
  expiringInDays: z.coerce.number().int().min(1).max(365).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListContractsQueryDto = z.infer<typeof ListContractsQuerySchema>;

// ─── Phase 2 F1 — Contract Templates ────────────────────────────────────────
// Reusable, versioned templates per tenant. The renderer interpolates only
// variables present in `variables` (allow-list) — anything else like
// `{{user.passwordHash}}` is replaced with an empty string. Defense against
// template injection (T-ESIGN per CLAUDE.md rule #3 + #5).

export const ContractTemplateVariableSchema = z.object({
  // Dotted path that maps to the renderer's data root, e.g. "company.name".
  // Restricted character set so a malicious key cannot navigate via `.. /` etc.
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.]*$/, 'key must be [a-zA-Z_.][a-zA-Z0-9_.]*'),
  label: z.string().max(120).optional(),
  type: z.enum(['string', 'number', 'date', 'boolean']).default('string'),
  required: z.boolean().default(false),
  // Default rendered when the caller omits the field. Kept as string for
  // simplicity — the renderer coerces per `type`.
  defaultValue: z.string().max(2048).optional(),
});
export type ContractTemplateVariableDto = z.infer<typeof ContractTemplateVariableSchema>;

export const ContractTemplateStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const CreateContractTemplateSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(2048).optional(),
  // Markdown body. 1 MiB cap mirrors DB column ceiling.
  bodyMd: z.string().min(1).max(1_048_576),
  variables: z.array(ContractTemplateVariableSchema).max(200).default([]),
});
export type CreateContractTemplateDto = z.infer<typeof CreateContractTemplateSchema>;

export const UpdateContractTemplateSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(2048).nullable(),
    bodyMd: z.string().min(1).max(1_048_576),
    variables: z.array(ContractTemplateVariableSchema).max(200),
    status: ContractTemplateStatusSchema,
  })
  .partial();
export type UpdateContractTemplateDto = z.infer<typeof UpdateContractTemplateSchema>;

export const ListContractTemplatesQuerySchema = z.object({
  status: ContractTemplateStatusSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListContractTemplatesQueryDto = z.infer<typeof ListContractTemplatesQuerySchema>;

// ─── Phase 2 F1 — Ceremony ──────────────────────────────────────────────────
// Send-for-signature kicks off the ceremony. Each signer gets a unique
// HMAC-signed ceremonyToken (mint + verify in ceremony.service.ts).
// SEQUENTIAL flow respects `order` (0-indexed); PARALLEL ignores it.

export const ContractSignerRoleSchema = z.enum(['TENANT_OWNER', 'COUNTERPARTY', 'WITNESS']);

export const SendForSignatureSignerSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  name: z.string().trim().min(1).max(255),
  // 0-indexed signing order. Ignored when mode = PARALLEL.
  order: z.number().int().min(0).max(50).default(0),
  role: ContractSignerRoleSchema.default('COUNTERPARTY'),
});

export const SendForSignatureSchema = z.object({
  // Required at send time so the renderer has a template to interpolate.
  // Caller may have set Contract.templateId already; if so we re-verify.
  templateId: z.string().min(1).max(64),
  // Per-template variable payload. Renderer validates keys against the
  // template's `variables` allow-list — extras dropped, missing required
  // ones throw 400.
  fieldValues: z.record(z.string().max(64), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  signers: z.array(SendForSignatureSignerSchema).min(1).max(20),
  mode: z.enum(['PARALLEL', 'SEQUENTIAL']).default('PARALLEL'),
  // Days from now until the ceremony auto-expires. Default 14 per spec D9.
  expiresInDays: z.number().int().min(1).max(90).default(14),
});
export type SendForSignatureDto = z.infer<typeof SendForSignatureSchema>;

// Public callback — bytes the counterparty submits at /p/sign/:token/sign.
// signatureImageBase64: data URL of a PNG drawn on the canvas widget.
// The service strict-validates the PNG header magic bytes (T-ESIGN-T-02).
export const SubmitSignatureSchema = z.object({
  signatureImageBase64: z
    .string()
    .min(1)
    // Strict regex enforces the data-URL prefix BEFORE we even hit the
    // strip-and-decode path. Anything not png mimetype → 400 here.
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'signatureImageBase64 must be a base64-encoded PNG data URL')
    .max(1_500_000), // ~1MB binary after base64 expansion
  // Canvas gesture trace (x/y/t triples) — optional, used as eIDAS AES
  // proof material. Capped to keep payload bounded.
  signatureProof: z
    .array(z.tuple([z.number(), z.number(), z.number()]))
    .max(20_000)
    .optional(),
  // Client clock — we ALSO record server time. Mismatch >5min is logged
  // but not rejected (clock skew is normal; the server time is the
  // legally-binding one).
  agreedAt: z.coerce.date(),
});
export type SubmitSignatureDto = z.infer<typeof SubmitSignatureSchema>;

export const DeclineSignatureSchema = z.object({
  reason: z.string().trim().min(1).max(2048),
});
export type DeclineSignatureDto = z.infer<typeof DeclineSignatureSchema>;

// Response payload for GET /p/sign/:token — what the counterparty sees
// before submitting. Includes a presigned PDF download URL (15min TTL,
// rotated on every GET). Tenant + contract names included for context.
export interface CeremonyViewResponse {
  contractTitle: string;
  tenantName: string;
  signerName: string;
  signerEmail: string;
  status: string;
  pdfDownloadUrl: string;
  expiresAt: string;
  // Other signers, ordered. Names + status only — no emails (PII).
  cosigners: Array<{ name: string; status: string; order: number }>;
  // Sequential flow: false until previous signers have all SIGNED.
  canSignNow: boolean;
}
