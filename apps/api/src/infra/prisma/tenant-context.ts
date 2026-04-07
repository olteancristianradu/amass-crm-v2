import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  userId?: string;
  role?: string;
}

/**
 * Per-request tenant context. Populated by TenantContextMiddleware after
 * JwtAuthGuard sets req.user. Read by:
 *  - PrismaService.$extends (auto-injects tenantId in queries)
 *  - PrismaService.runWithTenant (sets `app.tenant_id` for RLS)
 *  - AuditService (records actor + tenant)
 */
export const tenantStorage = new AsyncLocalStorage<TenantContext>();

export function getTenantContext(): TenantContext | undefined {
  return tenantStorage.getStore();
}

export function requireTenantContext(): TenantContext {
  const ctx = tenantStorage.getStore();
  if (!ctx) {
    throw new Error('Tenant context missing — middleware not applied or unauthenticated request path');
  }
  return ctx;
}
