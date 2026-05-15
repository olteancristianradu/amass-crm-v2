import { z } from 'zod';

/**
 * SCIM 2.0 (RFC 7643/7644) request schemas — minimal subset for /Users.
 *
 * We model only the fields Okta, Azure AD, and JumpCloud actually send when
 * provisioning a user. Anything missing here is dropped on the floor by Zod
 * (no `passthrough()`) so unknown extension attributes don't sneak into the
 * Prisma write path.
 *
 * B3-PR1 scope: Users only. Groups (PR2), bearer-token auth (PR3), and the
 * ServiceProviderConfig / ResourceTypes / Schemas meta endpoints (PR4) are
 * out of scope.
 */

export const SCIM_USER_SCHEMA_URN = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP_SCHEMA_URN = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST_RESPONSE_SCHEMA_URN = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_PATCH_OP_SCHEMA_URN = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';
export const SCIM_ERROR_SCHEMA_URN = 'urn:ietf:params:scim:api:messages:2.0:Error';

/** SCIM email entry. We persist only the primary email into User.email. */
export const ScimEmailSchema = z.object({
  value: z.string().email(),
  primary: z.boolean().optional().default(false),
  type: z.string().optional(),
});
export type ScimEmail = z.infer<typeof ScimEmailSchema>;

/** SCIM name complex attribute. We map this to User.fullName as `${given} ${family}`. */
export const ScimNameSchema = z.object({
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  formatted: z.string().optional(),
});
export type ScimName = z.infer<typeof ScimNameSchema>;

/**
 * Create + Replace use the same body shape per RFC 7644 §3.3/§3.5.1 — the
 * difference is semantic (POST creates, PUT fully overwrites), not structural.
 */
export const ScimUserCreateSchema = z.object({
  schemas: z.array(z.string()).min(1),
  userName: z.string().email(),
  name: ScimNameSchema,
  emails: z.array(ScimEmailSchema).min(1),
  active: z.boolean().optional().default(true),
});
export type ScimUserCreateDto = z.infer<typeof ScimUserCreateSchema>;

/**
 * PatchOp — RFC 7644 §3.5.2. We accept `add`/`replace`/`remove` at the wire
 * level so the validator doesn't reject Okta's full vocabulary, but the
 * service rejects everything except `replace` on a small allow-list of
 * paths (active, name.givenName, name.familyName, emails primary value).
 *
 * `value` is intentionally `unknown` — different paths take different value
 * shapes (boolean for active, string for name fields). The service narrows
 * at apply time.
 */
export const ScimPatchOpSchema = z.object({
  op: z.enum(['add', 'replace', 'remove', 'Add', 'Replace', 'Remove']),
  path: z.string().optional(),
  value: z.unknown().optional(),
});
export type ScimPatchOp = z.infer<typeof ScimPatchOpSchema>;

export const ScimPatchRequestSchema = z.object({
  schemas: z.array(z.string()).min(1),
  Operations: z.array(ScimPatchOpSchema).min(1),
});
export type ScimPatchRequestDto = z.infer<typeof ScimPatchRequestSchema>;

/**
 * Query params for GET /Users. SCIM uses 1-based pagination (startIndex=1
 * means "first row"), unlike most REST APIs — RFC 7644 §3.4.2.4.
 *
 * `count` capped at 100 to avoid OOM on a misbehaving IdP; max in RFC is
 * implementation-defined.
 */
export const ScimListQuerySchema = z.object({
  startIndex: z.coerce.number().int().min(1).default(1),
  count: z.coerce.number().int().min(0).max(100).default(50),
  filter: z.string().optional(),
});
export type ScimListQueryDto = z.infer<typeof ScimListQuerySchema>;

/**
 * SCIM Group resources (RFC 7643 §4.2). amass-crm has no Group/Team table —
 * groups are SYNTHESIZED 1:1 from the `UserRole` enum (OWNER, ADMIN, MANAGER,
 * AGENT, VIEWER). Each tenant therefore has exactly 5 read-only groups whose
 * `id` is `role:${UserRole}`, and "membership" is determined by `User.role`.
 *
 * Mutations land on `User.role`:
 *   - PATCH `op:add path:members value:[{value:userId}]`    → set User.role to this group's role
 *   - PATCH `op:remove path:members value:[{value:userId}]` → downgrade User.role to VIEWER
 *   - PUT (full replace of `members`)                       → diff vs current, then apply add/remove atomically
 *
 * POST and DELETE return 501 — these synthetic groups are fixed by the RBAC
 * enum and cannot be created or destroyed by an external IdP.
 */
export const ScimGroupMemberSchema = z.object({
  // SCIM Group member value is the User.id (string). We accept value, display
  // and type but only `value` is load-bearing at write time.
  value: z.string().min(1),
  display: z.string().optional(),
  type: z.string().optional(),
});
export type ScimGroupMember = z.infer<typeof ScimGroupMemberSchema>;

/** PUT body — full overwrite of the member set on a synthetic Role-group. */
export const ScimGroupReplaceSchema = z.object({
  schemas: z.array(z.string()).min(1),
  displayName: z.string().min(1).optional(),
  members: z.array(ScimGroupMemberSchema).default([]),
});
export type ScimGroupReplaceDto = z.infer<typeof ScimGroupReplaceSchema>;

/** POST body kept for shape parity with /Users — the service returns 501. */
export const ScimGroupCreateSchema = z.object({
  schemas: z.array(z.string()).min(1),
  displayName: z.string().min(1),
  members: z.array(ScimGroupMemberSchema).optional().default([]),
});
export type ScimGroupCreateDto = z.infer<typeof ScimGroupCreateSchema>;
