import { z } from 'zod';

export const CreateWhatsappAccountSchema = z.object({
  phoneNumberId: z.string().min(1).max(100),
  displayPhoneNumber: z.string().min(1).max(20),
  accessToken: z.string().min(1),
  webhookVerifyToken: z.string().min(8).max(100),
});
export type CreateWhatsappAccountDto = z.infer<typeof CreateWhatsappAccountSchema>;

export const SendWhatsappMessageSchema = z.object({
  subjectType: z.enum(['COMPANY', 'CONTACT', 'CLIENT']),
  subjectId: z.string().min(1).max(64),
  toNumber: z.string().min(5).max(20),
  body: z.string().min(1).max(4096),
});
export type SendWhatsappMessageDto = z.infer<typeof SendWhatsappMessageSchema>;
