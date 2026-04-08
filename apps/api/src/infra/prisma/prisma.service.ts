import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantContext } from './tenant-context';

/**
 * Models that store tenantId and must be auto-filtered.
 * NOTE: keep this in sync with schema.prisma — every tenant-scoped model goes here.
 * `tenants` itself is NOT in this list (lookups by slug happen pre-auth).
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  'User',
  'Session',
  'AuditLog',
  'Company',
  'Contact',
  'Client',
  'ImportJob',
  'Note',
  'Activity',
  'Attachment',
  'Reminder',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Run `fn` within a transaction where `app.tenant_id` is set so that
   * Postgres RLS policies filter rows to this tenant. Use this on every
   * request handler that touches tenant-scoped data.
   *
   * Layered with the extended client below for defense in depth.
   */
  async runWithTenant<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      // SET LOCAL is rolled back at transaction end → cannot leak between requests.
      // Quote-escape tenantId (Prisma cuids are alphanumeric, but be defensive).
      const safe = tenantId.replace(/'/g, "''");
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${safe}'`);
      // Drop superuser privileges for the rest of this transaction so that
      // RLS policies actually apply. The connection user (postgres) bypasses
      // RLS by default — switching to app_user (NOSUPERUSER NOBYPASSRLS)
      // makes the policies enforced. Reverted automatically at txn end.
      await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
      return fn(tx);
    });
  }
}

/**
 * Build a Prisma client extension that auto-injects tenantId on every
 * read/write of tenant-scoped models. This is defense layer 2: if someone
 * forgets the WHERE clause, the extension adds it. RLS (layer 3) is the
 * last line of defense.
 *
 * Apply this in providers via `PrismaService.prototype.$extends(tenantExtension())`,
 * but for clarity we'll wire it explicitly in modules that need it.
 */
export function tenantExtension() {
  return Prisma.defineExtension({
    name: 'tenant-isolation',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) {
            return query(args);
          }
          const ctx = getTenantContext();
          if (!ctx) {
            // No context = pre-auth path (login, register). Allow but rely on RLS + app code.
            return query(args);
          }
          const tenantId = ctx.tenantId;

          // Inject tenantId into where / data depending on the op.
          const a = args as Record<string, unknown>;
          if (
            operation === 'findFirst' ||
            operation === 'findMany' ||
            operation === 'findUnique' ||
            operation === 'count' ||
            operation === 'aggregate' ||
            operation === 'groupBy' ||
            operation === 'updateMany' ||
            operation === 'deleteMany'
          ) {
            a.where = { ...((a.where as object | undefined) ?? {}), tenantId };
          } else if (operation === 'update' || operation === 'delete' || operation === 'upsert') {
            a.where = { ...((a.where as object | undefined) ?? {}), tenantId };
          } else if (operation === 'create') {
            a.data = { ...((a.data as object | undefined) ?? {}), tenantId };
          } else if (operation === 'createMany') {
            const data = a.data;
            if (Array.isArray(data)) {
              a.data = data.map((row) => ({ ...(row as object), tenantId }));
            }
          }
          return query(a);
        },
      },
    },
  });
}
