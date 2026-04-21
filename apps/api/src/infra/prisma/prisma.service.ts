import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantContext } from './tenant-context';

/**
 * Models that store tenantId and must be auto-filtered.
 * NOTE: keep this in sync with schema.prisma — every tenant-scoped model goes here.
 * `tenants` itself is NOT in this list (lookups by slug happen pre-auth).
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  'Activity',
  'AnafSubmission',
  'ApprovalDecision',
  'ApprovalPolicy',
  'ApprovalRequest',
  'Attachment',
  'AuditLog',
  'BillingSubscription',
  'CalendarEvent',
  'CalendarIntegration',
  'Call',
  'CallTranscript',
  'Campaign',
  'Case',
  'ChatterPost',
  'Client',
  'Commission',
  'CommissionPlan',
  'Company',
  'Contact',
  'ContactSegment',
  'Contract',
  'CustomFieldDef',
  'CustomFieldValue',
  'CustomerSubscription',
  'DataExport',
  'Deal',
  'EmailAccount',
  'EmailMessage',
  'EmailSequence',
  'EmailSequenceStep',
  'EmailTrack',
  'Event',
  'ForecastQuota',
  'FormulaField',
  'ImportJob',
  'Invoice',
  'InvoiceLine',
  'Lead',
  'LeadScore',
  'Note',
  'Notification',
  'Order',
  'Payment',
  'PhoneNumber',
  'Pipeline',
  'PipelineStage',
  'PortalToken',
  'PriceList',
  'PriceListItem',
  'Product',
  'ProductBundle',
  'ProductCategory',
  'ProductVariant',
  'Project',
  'Quote',
  'QuoteLine',
  'Reminder',
  'ReportTemplate',
  'SequenceEnrollment',
  'Session',
  'SmsMessage',
  'SsoConfig',
  'Task',
  'Territory',
  'User',
  'ValidationRule',
  'WebhookEndpoint',
  'WhatsappAccount',
  'WhatsappMessage',
  'Workflow',
  'WorkflowRun',
  'WorkflowStep',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /**
   * B-scaling: optional read-replica client. Lazily instantiated when
   * DATABASE_REPLICA_URL is set. Reads routed via `runWithTenant(id, 'ro', fn)`
   * go here; everything else still uses the primary client. When the replica
   * URL is unset, `readClient === this` so callers never need to branch.
   */
  private readonly readClient: PrismaClient;

  constructor() {
    super({
      datasources: {
        db: {
          // Cap the connection pool to prevent exhausting Postgres max_connections.
          // Formula: (max_connections - 5 system slots) / (number of API replicas).
          // Default Postgres: 100 connections. Single replica → 20 app + headroom.
          url: PrismaService.buildDatabaseUrl(process.env.DATABASE_URL),
        },
      },
    });

    const replicaUrl = process.env.DATABASE_REPLICA_URL;
    this.readClient = replicaUrl
      ? new PrismaClient({
          datasources: { db: { url: PrismaService.buildDatabaseUrl(replicaUrl) } },
        })
      : (this as unknown as PrismaClient);
  }

  private static buildDatabaseUrl(input: string | undefined): string {
    const base = input ?? '';
    if (!base) return base;
    // Append pool params only if not already present in the URL.
    if (base.includes('connection_limit')) return base;
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}connection_limit=20&pool_timeout=10`;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    if (this.readClient !== (this as unknown as PrismaClient)) {
      await this.readClient.$connect();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    if (this.readClient !== (this as unknown as PrismaClient)) {
      await this.readClient.$disconnect();
    }
  }

  /**
   * Run `fn` within a transaction where `app.tenant_id` is set so that
   * Postgres RLS policies filter rows to this tenant. Use this on every
   * request handler that touches tenant-scoped data.
   *
   * Layered with the extended client below for defense in depth.
   */
  async runWithTenant<T>(tenantId: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  async runWithTenant<T>(
    tenantId: string,
    mode: 'ro' | 'rw',
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T>;
  async runWithTenant<T>(
    tenantId: string,
    modeOrFn: 'ro' | 'rw' | ((tx: Prisma.TransactionClient) => Promise<T>),
    maybeFn?: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const mode: 'ro' | 'rw' = typeof modeOrFn === 'function' ? 'rw' : modeOrFn;
    const fn = typeof modeOrFn === 'function' ? modeOrFn : (maybeFn as (tx: Prisma.TransactionClient) => Promise<T>);

    // M-9: Postgres SET LOCAL does NOT accept parameter placeholders for the
    // value — the server-side configuration protocol is text-only. Strict
    // allow-list prevents injection; see isValidTenantId below.
    if (!PrismaService.isValidTenantId(tenantId)) {
      throw new Error('runWithTenant: tenantId failed format validation');
    }

    // Reads go to the replica client when one is configured; writes always
    // hit the primary. Both use the same RLS SET LOCAL dance.
    const target =
      mode === 'ro' && this.readClient !== (this as unknown as PrismaClient) ? this.readClient : this;

    return target.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
      await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
      if (mode === 'ro') {
        // On replica this is required (host is read-only anyway); on primary
        // it's belt-and-braces — any accidental write throws immediately.
        await tx.$executeRawUnsafe(`SET LOCAL transaction_read_only = on`);
      }
      return fn(tx);
    });
  }

  /**
   * Strict format allow-list for tenant ids. We accept:
   *   - cuids (Prisma default):   /^c[a-z0-9]{24}$/
   *   - UUID v1-v5:               /^[0-9a-f-]{36}$/i with dashes at 8/13/18/23
   * Rejecting anything else removes the possibility of SQL injection via the
   * SET LOCAL path even in the presence of a bug upstream.
   */
  static isValidTenantId(id: unknown): id is string {
    if (typeof id !== 'string') return false;
    if (/^c[a-z0-9]{24}$/.test(id)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return true;
    return false;
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
