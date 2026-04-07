import { z } from 'zod';

export const RegisterSchema = z.object({
  tenantSlug: z.string().min(2).max(64),
  tenantName: z.string().min(2).max(128).optional(),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  fullName: z.string().min(1).max(128),
});
export type RegisterDto = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  tenantSlug: z.string().min(2).max(64),
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;
