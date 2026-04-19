import { z } from 'zod';

/**
 * Tenant's customer recurring subscriptions — powers MRR/ARR/churn dashboard.
 * Distinct from BillingSubscription (SaaS plan the tenant pays us).
 */
export const CustomerSubscriptionStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'CANCELLED', 'EXPIRED']);
export type CustomerSubscriptionStatusDto = z.infer<typeof CustomerSubscriptionStatusSchema>;

export const CreateCustomerSubscriptionSchema = z.object({
  companyId: z.string().min(1).max(64),
  name: z.string().trim().min(1).max(200),
  plan: z.string().trim().max(100).optional(),
  mrr: z.coerce.number().nonnegative(),
  currency: z.string().trim().min(3).max(3).default('RON'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
});
export type CreateCustomerSubscriptionDto = z.infer<typeof CreateCustomerSubscriptionSchema>;

export const UpdateCustomerSubscriptionSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    plan: z.string().trim().max(100).nullable(),
    status: CustomerSubscriptionStatusSchema,
    mrr: z.coerce.number().nonnegative(),
    currency: z.string().trim().min(3).max(3),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().nullable(),
  })
  .partial();
export type UpdateCustomerSubscriptionDto = z.infer<typeof UpdateCustomerSubscriptionSchema>;

export const ListCustomerSubscriptionsQuerySchema = z.object({
  status: CustomerSubscriptionStatusSchema.optional(),
  companyId: z.string().min(1).max(64).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListCustomerSubscriptionsQueryDto = z.infer<typeof ListCustomerSubscriptionsQuerySchema>;
