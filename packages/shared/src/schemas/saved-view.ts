import { z } from 'zod';

/**
 * Saved view — per-user, per-resource snapshot of a list page's filters,
 * search query, and sort. Selecting a view re-applies its `filters` blob.
 *
 * `resource` is an enum allow-list (T-SV-T-01 mitigation): the server only
 * accepts list pages it knows about, so a malicious client can't smuggle
 * an arbitrary string that leaks into SQL/log fields downstream.
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

// T-SV-I-03 — stored XSS via `name`. Names like "RO SMBs >5 employees stale"
// are legitimate so we don't blanket-ban `<` / `>`. Instead:
//   1. reject ASCII control chars (\x00–\x1F, \x7F) — never useful, breaks logs;
//   2. reject Unicode bidi-control codepoints (U+202A–U+202E, U+2066–U+2069)
//      that flip visual direction of text — "Confirm[U+202E]Delete" renders
//      as "Delete Confirm" and tricks users into wrong action (T-I18N-S-02
//      applied to saved-view names);
//   3. reject literal HTML/JS injection patterns case-insensitively;
//   4. cap length (handled separately via .max()).
// The frontend MUST still output-encode (React does by default), but server-
// side rejection of obvious attack strings is non-negotiable defence in depth.
const FORBIDDEN_NAME_PATTERNS: RegExp[] = [
  /[\x00-\x1F\x7F]/, // C0 controls + DEL
  // Bidi/RTL override + isolate codepoints — declared via \u escapes so the
  // source file stays free of actual bidi chars (security/detect-bidi-characters):
  //   U+202A LRE, U+202B RLE, U+202C PDF, U+202D LRO, U+202E RLO
  //   U+2066 LRI, U+2067 RLI, U+2068 FSI, U+2069 PDI
  /[\u202A-\u202E\u2066-\u2069]/,
  /<\s*script/i,
  /<\s*iframe/i,
  /<\s*img[^>]*onerror/i,
  /<\s*svg[^>]*on[a-z]+\s*=/i,
  /javascript:/i,
  /\bon[a-z]+\s*=\s*["'`]/i, // onclick=, onerror= … with quoted value
];

// T-SV-T-02 — prototype pollution: a JSON body like
// `{"filters":{"__proto__":{"isAdmin":true}}}` mutates Object.prototype
// for the whole Node process when merged naively. We refuse any filter
// key that matches a dangerous prototype slot.
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function assertNoPrototypePollution(
  value: unknown,
  path: string[],
  ctx: z.RefinementCtx,
  depth = 0,
): void {
  if (depth > 8) {
    // Bound recursion: pathological nested JSON is also a DoS vector.
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message: 'filters_too_deep',
    });
    return;
  }
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoPrototypePollution(v, [...path, String(i)], ctx, depth + 1));
    return;
  }
  for (const key of Object.keys(value)) {
    if (DANGEROUS_KEYS.has(key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [...path, key],
        message: 'forbidden_key',
      });
      return;
    }
    assertNoPrototypePollution(
      (value as Record<string, unknown>)[key],
      [...path, key],
      ctx,
      depth + 1,
    );
  }
}

// `z.record(z.unknown())` accepts only plain JSON objects (not arrays / not
// strings) — Zod's parser treats record as a typeof === 'object' && !Array
// check, so we don't need extra guards for that boundary.
const FiltersSchema = z
  .record(z.string(), z.unknown())
  .superRefine((val, ctx) => assertNoPrototypePollution(val, [], ctx));

// `.strict()` on the create / update DTOs is the T-SV-S-01 mass-assignment
// defence — a body that smuggles `ownerId: <victim>` or `tenantId: <other>`
// returns 400 instead of being silently dropped (the service still pulls
// owner/tenant from ALS regardless, but failing closed is the rule).
export const CreateSavedViewSchema = z
  .object({
    resource: SavedViewResourceSchema,
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(
        (n) => !FORBIDDEN_NAME_PATTERNS.some((re) => re.test(n)),
        { message: 'invalid_chars' },
      ),
    filters: FiltersSchema,
  })
  .strict();
export type CreateSavedViewDto = z.infer<typeof CreateSavedViewSchema>;

export const UpdateSavedViewSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(
        (n) => !FORBIDDEN_NAME_PATTERNS.some((re) => re.test(n)),
        { message: 'invalid_chars' },
      )
      .optional(),
    filters: FiltersSchema.optional(),
  })
  .strict()
  .refine((d) => d.name !== undefined || d.filters !== undefined, {
    message: 'at_least_one_field_required',
  });
export type UpdateSavedViewDto = z.infer<typeof UpdateSavedViewSchema>;

export const ListSavedViewsQuerySchema = z.object({
  resource: SavedViewResourceSchema,
});
export type ListSavedViewsQueryDto = z.infer<typeof ListSavedViewsQuerySchema>;

/**
 * System default views — read-only, NOT persisted. Each list page can
 * provide a small set of opinionated starter views ("Won this month",
 * "Active leads", etc). Phase 0 ships defaults only for `deals`; other
 * resources return an empty array and the FE falls back to its own
 * client-side defaults.
 *
 * Localized labels are picked by the FE based on the active i18n locale —
 * the server returns a stable string key and the FE looks it up.
 */
export interface SystemDefaultView {
  id: string; // synthetic, prefixed `system:` so it never collides with a real cuid
  resource: SavedViewResource;
  nameKey: string; // i18n key, e.g. 'savedViews.defaults.deals.allMine'
  filters: Record<string, unknown>;
}
