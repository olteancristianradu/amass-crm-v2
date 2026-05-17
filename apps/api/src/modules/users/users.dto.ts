import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { LocaleSchema } from '@amass/shared';

export const InviteUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(1).max(128),
  role: z.nativeEnum(UserRole).default(UserRole.AGENT),
  // Temporary password — user should change on first login.
  password: z.string().min(8).max(128),
});
export type InviteUserDto = z.infer<typeof InviteUserSchema>;

export const UpdateUserRoleSchema = z.object({
  role: z.nativeEnum(UserRole),
});
export type UpdateUserRoleDto = z.infer<typeof UpdateUserRoleSchema>;

/**
 * Phase 0 / Feature 1 — locale switch.
 *
 * `locale` is whitelisted against the shared `LocaleSchema` (ro|en today)
 * so a bidi-control attack (T-I18N-S-02) or path-traversal email-template
 * attempt fails at Zod parse — no need for downstream sanitisation. Body
 * shape is intentionally minimal so a future expansion to `{ locale,
 * timezone, dateFormat }` doesn't break this endpoint's contract.
 */
export const UpdateMyLocaleSchema = z.object({
  locale: LocaleSchema,
});
export type UpdateMyLocaleDto = z.infer<typeof UpdateMyLocaleSchema>;
