import { UserRole } from '@prisma/client';
import { z } from 'zod';

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
