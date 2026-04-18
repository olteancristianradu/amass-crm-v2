import { z } from 'zod';

export const RequestPortalAccessSchema = z.object({
  email: z.string().email(),
  tenantSlug: z.string().min(1).max(64),
  companyId: z.string().optional(),
  clientId: z.string().optional(),
});
export type RequestPortalAccessDto = z.infer<typeof RequestPortalAccessSchema>;

export const VerifyPortalTokenSchema = z.object({
  token: z.string().min(1),
});
export type VerifyPortalTokenDto = z.infer<typeof VerifyPortalTokenSchema>;

export const SignQuotePortalSchema = z.object({
  signatureBase64: z.string().min(1),
  signerName: z.string().min(1).max(200),
});
export type SignQuotePortalDto = z.infer<typeof SignQuotePortalSchema>;
