import { z } from 'zod';
import { LocaleSchema, LOCALE_VALUES } from '@amass/shared';

/**
 * Phase 0 / Feature 1 — tenant default locale + enabled list.
 *
 * `defaultLocale` MUST be a member of `enabledLocales` (cross-field rule
 * enforced via `.refine()`). Capped list size (2 today, room for ~10
 * post-launch) — bigger would explode the language switcher UX.
 */
export const UpdateTenantLocaleSchema = z
  .object({
    defaultLocale: LocaleSchema,
    enabledLocales: z
      .array(LocaleSchema)
      .min(1)
      .max(LOCALE_VALUES.length)
      .refine((arr) => new Set(arr).size === arr.length, {
        message: 'enabledLocales must be unique',
      }),
  })
  .refine((dto) => dto.enabledLocales.includes(dto.defaultLocale), {
    message: 'defaultLocale must be in enabledLocales',
    path: ['defaultLocale'],
  });
export type UpdateTenantLocaleDto = z.infer<typeof UpdateTenantLocaleSchema>;
