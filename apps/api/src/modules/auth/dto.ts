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
  // Optional now. If absent, the service looks up the email across all tenants;
  // single-tenant match → proceeds; multi-tenant match → 409 TENANT_PICKER_REQUIRED
  // and the FE shows a dropdown for the user to pick.
  tenantSlug: z.string().min(2).max(64).optional(),
  email: z.string().email(),
  password: z.string().min(1),
  // 6-digit TOTP code — required only when the account has 2FA enabled.
  totpCode: z.string().length(6).optional(),
});
export type LoginDto = z.infer<typeof LoginSchema>;

export const RefreshSchema = z.object({
  refreshToken: z.string().min(10),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;

export const RequestPasswordResetSchema = z.object({
  tenantSlug: z.string().min(2).max(64),
  email: z.string().email(),
});
export type RequestPasswordResetDto = z.infer<typeof RequestPasswordResetSchema>;

export const ConfirmPasswordResetSchema = z.object({
  // Raw token (b64url) — NEVER log this.
  token: z.string().min(32).max(128),
  newPassword: z.string().min(8).max(128),
});
export type ConfirmPasswordResetDto = z.infer<typeof ConfirmPasswordResetSchema>;

export const ConfirmEmailVerificationSchema = z.object({
  token: z.string().min(32).max(128),
});
export type ConfirmEmailVerificationDto = z.infer<typeof ConfirmEmailVerificationSchema>;
