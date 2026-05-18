import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { getTenantContext, tenantStorage } from './tenant-context';

/**
 * Models that store tenantId and must be auto-filtered.
 * NOTE: keep this in sync with schema.prisma — every tenant-scoped model goes here.
 * `tenants` itself is NOT in this list (lookups by slug happen pre-auth).
 *
 * Exported so prisma.service.spec.ts can introspect schema.prisma and assert
 * every model with a `tenantId` column is registered here — silent omissions
 * = silent multi-tenant isolation breach (CLAUDE.md rule #3).
 */
export const TENANT_SCOPED_MODELS = new Set<string>([
  'Activity',
  'AnafSubmission',
  'ApprovalDecision',
  'ApprovalPolicy',
  'ApprovalRequest',
  // Phase 2 — per-step state for multi-step approval workflows
  // (migration 20260518173000).
  'ApprovalStep',
  'Attachment',
  'AuditLog',
  'BillingSubscription',
  'CalendarEvent',
  'CalendarIntegration',
  'Call',
  'CallTranscript',
  'Campaign',
  // Phase 1 — per-recipient send attribution (new model 20260518110000).
  'CampaignRecipient',
  'Case',
  'ChatterPost',
  'Client',
  'CockpitLayout',
  'Commission',
  'CommissionPlan',
  'Company',
  'ConsentRecord',
  'Contact',
  'ContactSegment',
  'Contract',
  // Phase 2 — hash-chained, append-only audit trail for e-sign
  // (migration 20260518171000). 7y retention per Cod Fiscal RO art. 25(1)(e).
  'ContractAuditEntry',
  // Phase 2 — per-signer ceremony state with HMAC token
  // (migration 20260518170100).
  'ContractSignature',
  // Phase 2 — high-cardinality per-signer lifecycle event log
  // (migration 20260518170100).
  'ContractSignatureEvent',
  // Phase 2 — reusable, versioned contract templates per tenant
  // (migration 20260518170500).
  'ContractTemplate',
  'CustomFieldDef',
  'CustomFieldValue',
  'CustomerSubscription',
  'DataExport',
  'Deal',
  'EmailAccount',
  'EmailMessage',
  'EmailSequence',
  'EmailSequenceStep',
  // Phase 1 — GDPR hash-based suppression list (new model 20260518130000).
  'EmailSuppression',
  'EmailTrack',
  'Event',
  'EventAttendee',
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
  'OrderItem',
  // Phase 1 F3 outbox pattern (new model 20260518150000). Tenant-scoped
  // because every outbox event must be filterable + RLS-isolated per tenant.
  'OutboxEvent',
  'Passkey',
  'Payment',
  'PhoneNumber',
  'Pipeline',
  'PipelineStage',
  'PortalToken',
  'PriceList',
  'PriceListItem',
  'Product',
  'ProductBundle',
  'ProductBundleItem',
  'ProductCategory',
  'ProductVariant',
  'Project',
  'Quote',
  'QuoteLine',
  'Reminder',
  'ReportTemplate',
  'SavedView',
  // B3-PR3 SCIM bearer tokens — added per B3-PR4 e2e finding (writes to
  // scim_tokens previously bypassed tenantExtension because the model
  // wasn't in this set, causing 500 on POST /scim/tokens).
  'ScimToken',
  'SequenceEnrollment',
  'Session',
  'SmsMessage',
  'SsoConfig',
  'Task',
  'Territory',
  'TerritoryAssignment',
  'Tag',
  'EntityTag',
  'OutlookToken',
  'User',
  'ValidationRule',
  'WebhookDelivery',
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

  /**
   * Defense-in-depth Layer 2: a view of the primary client with
   * {@link tenantExtension} applied. Every query routed through this client
   * gets `tenantId` auto-injected (read) or stamped (write) when a tenant
   * context is present in AsyncLocalStorage.
   *
   * Wired by onModuleInit so `$extends()` runs after `$connect()`. The type
   * from `$extends` is structurally broader than PrismaClient; we keep it
   * `unknown` internally and cast at the $transaction call-site — the tx
   * handed to callers is still a `Prisma.TransactionClient` structurally.
   */
  private extended!: { $transaction: PrismaClient['$transaction'] };
  private readExtended!: { $transaction: PrismaClient['$transaction'] };

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
    // Apply the tenant-isolation extension. `$extends` returns a new client
    // object; on `$transaction` the tx inherits the extension, which is how
    // we get auto-injected tenantId on every query issued via runWithTenant.
    this.extended = this.$extends(tenantExtension()) as unknown as typeof this.extended;
    this.readExtended = this.readClient.$extends(tenantExtension()) as unknown as typeof this.readExtended;
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

    // Defense in depth — the tenantId SHOULD always come from ALS context,
    // populated by TenantContextMiddleware from a JWT that we signed, so it is
    // not user-controlled in practice. But this function is exported and
    // could be called from code that bypassed the middleware, so we enforce
    // a strict format allow-list as the first line of defense.
    if (!PrismaService.isValidTenantId(tenantId)) {
      throw new Error('runWithTenant: tenantId failed format validation');
    }

    // Reads go to the replica client when one is configured; writes always
    // hit the primary. Both go through the EXTENDED client so tx gets
    // tenantExtension wired — this is Layer 2 of defense-in-depth (Layer 1
    // = JWT+RolesGuard+TenantContextMiddleware in ALS, Layer 3 = Postgres
    // RLS via set_config() below).
    const target =
      mode === 'ro' && this.readClient !== (this as unknown as PrismaClient) ? this.readExtended : this.extended;

    // B3-PR4 e2e finding: TenantContextMiddleware sets ALS for JWT-auth
    // requests, but the SCIM bearer-token flow (and any future non-JWT
    // auth) does NOT go through that middleware — so `getTenantContext()`
    // returns undefined inside the transaction callback, and the
    // `tenantExtension()` no-ops on every write → `Argument tenant is
    // missing` PrismaClientValidationError.
    //
    // Fix: runWithTenant now ENSURES an ALS context exists for the
    // transaction lifetime. If one is already present (JWT path), we
    // KEEP IT UNCHANGED — overriding the upstream tenantId would silence
    // legitimate developer-error / cross-tenant-write attempts that RLS
    // is meant to catch (regression caught by multi-tenant.e2e.spec.ts
    // "RLS: writing to wrong tenant from inside runWithTenant fails").
    // Only when there's no upstream context do we synthesize one.
    //
    // Defense-in-depth invariant intact:
    //  - SET LOCAL app.tenant_id below → Postgres RLS uses the caller-
    //    supplied tenantId regardless of ALS, so cross-tenant writes
    //    still fail at the DB layer.
    //  - tenantExtension reads the now-populated ALS and stamps reads/
    //    writes with the original ALS tenant (JWT case) OR the caller's
    //    tenant (SCIM bearer case).
    const ctx = getTenantContext() ?? { tenantId };

    return tenantStorage.run(ctx, () =>
      target.$transaction(async (tx) => {
        // `set_config(name, value, is_local=true)` is the parameter-bindable
        // equivalent of `SET LOCAL name = value`. Prefer this over the old
        // `$executeRawUnsafe(`SET LOCAL ... = '${tenantId}'`)` path because
        // Prisma's tagged-template `$executeRaw` binds the placeholder, so
        // even if `isValidTenantId` above ever regressed, the value cannot
        // break out of the SQL string literal.
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        // SET ROLE has no parameter-bindable form, but 'app_user' is a
        // hardcoded identifier (not user input) so it is injection-proof.
        await tx.$executeRawUnsafe(`SET LOCAL ROLE app_user`);
        if (mode === 'ro') {
          // On replica this is required (host is read-only anyway); on primary
          // it's belt-and-braces — any accidental write throws immediately.
          await tx.$executeRawUnsafe(`SET LOCAL transaction_read_only = on`);
        }
        return fn(tx as unknown as Prisma.TransactionClient);
      }),
    ) as Promise<T>;
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
 * Wired globally by {@link PrismaService.onModuleInit} onto both the primary
 * and read-replica clients. Every `runWithTenant(tenantId, ..., fn)` call
 * opens a transaction on the extended client, so the `tx` handed to `fn`
 * inherits this extension and filters by tenant automatically when
 * AsyncLocalStorage holds a tenant context.
 *
 * When no tenant context is present (pre-auth slug lookups, seed scripts),
 * the extension no-ops and defers to the app code / RLS for safety.
 */
/**
 * Pure mutation rule extracted so it can be unit-tested without spinning up
 * Prisma. Returns a NEW args object with `tenantId` stamped on `where` or
 * `data`, depending on the operation. No-ops when the model is not tenant
 * scoped or when ctx is missing (pre-auth path).
 */
export function applyTenantScope(
  model: string | undefined,
  operation: string,
  args: Record<string, unknown>,
  ctx: { tenantId: string } | undefined | null,
): Record<string, unknown> {
  if (!model || !TENANT_SCOPED_MODELS.has(model)) return args;
  if (!ctx) return args;
  const tenantId = ctx.tenantId;
  const a: Record<string, unknown> = { ...args };

  // IMPORTANT semantics for read/update/delete WHERE clauses + create/createMany DATA:
  //
  // Only STAMP tenantId when the caller hasn't explicitly provided one.
  // If they did provide one (e.g. `where: { id, tenantId: 'B' }` from
  // inside a runWithTenant('A', ...)), DO NOT override — pass it through
  // verbatim and let Postgres RLS catch the mismatch.
  //
  // This preserves two invariants:
  //   1. The "forgotten where" case (the original purpose of this
  //      extension): app code that forgets `where: { tenantId }` is
  //      auto-corrected, never leaking cross-tenant rows.
  //   2. The "developer mismatch / hostile insert" case: app code that
  //      explicitly asks for tenant B from inside a tenant-A txn gets
  //      REJECTED by RLS, not silently coerced. multi-tenant.e2e.spec.ts
  //      "RLS: writing to wrong tenant from inside runWithTenant fails"
  //      pins this contract.
  if (
    operation === 'findFirst' ||
    operation === 'findMany' ||
    operation === 'findUnique' ||
    operation === 'count' ||
    operation === 'aggregate' ||
    operation === 'groupBy' ||
    operation === 'updateMany' ||
    operation === 'deleteMany' ||
    operation === 'update' ||
    operation === 'delete' ||
    operation === 'upsert'
  ) {
    const whereObj = (a.where as Record<string, unknown> | undefined) ?? {};
    a.where = 'tenantId' in whereObj ? whereObj : { ...whereObj, tenantId };
  } else if (operation === 'create') {
    const dataObj = (a.data as Record<string, unknown> | undefined) ?? {};
    a.data = 'tenantId' in dataObj ? dataObj : { ...dataObj, tenantId };
  } else if (operation === 'createMany') {
    const data = a.data;
    if (Array.isArray(data)) {
      a.data = data.map((row) => {
        const r = row as Record<string, unknown>;
        return 'tenantId' in r ? r : { ...r, tenantId };
      });
    }
  }
  return a;
}

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
          const mutated = applyTenantScope(model, operation, args as Record<string, unknown>, ctx);
          return query(mutated);
        },
      },
    },
  });
}
