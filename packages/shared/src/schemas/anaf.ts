import { z } from 'zod';

export const AnafTenantConfigSchema = z.object({
  // CUI without RO prefix
  vatNumber: z.string().min(2).max(10),
  companyName: z.string().min(1).max(200),
  addressLine: z.string().min(1).max(300),
  city: z.string().min(1).max(100),
  county: z.string().min(1).max(100),
  // ANAF OAuth client credentials (obtained from anaf.ro developer portal)
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  // Optional: test mode (uses anaf.ro sandbox)
  sandbox: z.boolean().default(false),
});
export type AnafTenantConfigDto = z.infer<typeof AnafTenantConfigSchema>;
