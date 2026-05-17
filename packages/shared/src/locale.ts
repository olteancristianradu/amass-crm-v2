import { z } from 'zod';

/**
 * Phase 0 / Migration A — i18n locale primitives shared between BE + FE.
 *
 * The catalog shipped in `apps/web/src/i18n/{ro,en}/*.json` covers exactly
 * these two locales (52 namespaces each, 1538 keys, parity-checked).
 * The Prisma columns `Tenant.defaultLocale`, `Tenant.enabledLocales`,
 * `User.preferredLocale` all use these short codes (NOT `ro-RO` / `en-US`)
 * because the catalog is region-agnostic and ALTER TYPE on a Postgres
 * enum is painful — keeping it as a varchar with Zod-enforced whitelist
 * lets `de`, `hu`, `it`, `es`, `fr`, `pl` slot in without a schema change.
 *
 * T-I18N-S-02 (RTL / bidi override mitigation): consumers MUST validate
 * any user-controlled locale string against `LocaleSchema` before passing
 * it to i18next.changeLanguage(); Zod rejects anything outside the
 * whitelist, including Unicode bidi control codepoints (U+202A..U+202E,
 * U+2066..U+2069) that would silently flip rendering direction.
 */
export const LOCALE_VALUES = ['ro', 'en'] as const;

export type Locale = (typeof LOCALE_VALUES)[number];

export const LocaleSchema = z.enum(LOCALE_VALUES);

/** Default fallback when nothing else resolves — matches `Tenant.defaultLocale`. */
export const DEFAULT_LOCALE: Locale = 'ro';

/**
 * Cascade: user preference (if set and still enabled by tenant) → tenant
 * default → DEFAULT_LOCALE. Returning `Locale` keeps the call site type-safe.
 *
 * Pure function — no DB. Callers fetch `{preferredLocale, defaultLocale,
 * enabledLocales}` themselves so this can run in BE templates AND FE store.
 */
export function resolveLocale(args: {
  userPreferred: string | null | undefined;
  tenantDefault: string | null | undefined;
  enabledLocales: readonly string[];
}): Locale {
  const enabled = new Set(args.enabledLocales);
  const userParsed = LocaleSchema.safeParse(args.userPreferred);
  if (userParsed.success && enabled.has(userParsed.data)) return userParsed.data;

  const tenantParsed = LocaleSchema.safeParse(args.tenantDefault);
  if (tenantParsed.success) return tenantParsed.data;

  return DEFAULT_LOCALE;
}

/**
 * Parse Accept-Language header into a single best-match locale, capped at
 * the first N entries to defuse T-I18N-D-01 (CPU exhaustion via 1000+ q-values).
 * Returns null when no entry matches the whitelist — caller falls back to
 * the cascade above.
 */
export function parseAcceptLanguage(
  header: string | null | undefined,
  enabledLocales: readonly string[],
  maxEntries = 10,
): Locale | null {
  if (!header) return null;
  const enabled = new Set(enabledLocales);
  const entries = header.split(',').slice(0, maxEntries);
  for (const raw of entries) {
    // Strip q-value and trim. We only look at the language tag prefix,
    // so "en-US" matches our short "en".
    const tag = raw.split(';')[0]?.trim().toLowerCase() ?? '';
    const short = tag.split('-')[0] ?? '';
    const parsed = LocaleSchema.safeParse(short);
    if (parsed.success && enabled.has(parsed.data)) return parsed.data;
  }
  return null;
}
