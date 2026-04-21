import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { TenantThrottlerGuard } from './common/guards/tenant-throttler.guard';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/queue/queue.module';
import { RedisModule } from './infra/redis/redis.module';
import { StorageModule } from './infra/storage/storage.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { ClientsModule } from './modules/clients/clients.module';
import { CompaniesModule } from './modules/companies/companies.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ImporterModule } from './modules/importer/importer.module';
import { DealsModule } from './modules/deals/deals.module';
import { AiModule } from './modules/ai/ai.module';
import { WorkflowsModule } from './modules/workflows/workflows.module';
import { ReportsModule } from './modules/reports/reports.module';
import { GdprModule } from './modules/gdpr/gdpr.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './infra/metrics/metrics.module';
import { SchedulerModule } from './infra/scheduler/scheduler.module';
import { CallsModule } from './modules/calls/calls.module';
import { EmailModule } from './modules/email/email.module';
import { EmailTrackingModule } from './modules/email-tracking/email-tracking.module';
import { NotesModule } from './modules/notes/notes.module';
import { PipelinesModule } from './modules/pipelines/pipelines.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { QuotesModule } from './modules/quotes/quotes.module';
import { EmailSequencesModule } from './modules/email-sequences/email-sequences.module';
import { ContactSegmentsModule } from './modules/contact-segments/contact-segments.module';
import { DuplicatesModule } from './modules/duplicates/duplicates.module';
import { ProductsModule } from './modules/products/products.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { SsoModule } from './modules/sso/sso.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { AnafModule } from './modules/anaf/anaf.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { ReportBuilderModule } from './modules/report-builder/report-builder.module';
import { LeadScoringModule } from './modules/lead-scoring/lead-scoring.module';
import { PortalModule } from './modules/portal/portal.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ExportsModule } from './modules/exports/exports.module';
import { SmsModule } from './modules/sms/sms.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { BillingModule } from './modules/billing/billing.module';
import { LeadsModule } from './modules/leads/leads.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { ForecastingModule } from './modules/forecasting/forecasting.module';
import { CasesModule } from './modules/cases/cases.module';
import { OrdersModule } from './modules/orders/orders.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { CustomerSubscriptionsModule } from './modules/customer-subscriptions/customer-subscriptions.module';
import { ValidationRulesModule } from './modules/validation-rules/validation-rules.module';
import { FormulaFieldsModule } from './modules/formula-fields/formula-fields.module';
import { ProductVariantsModule } from './modules/product-variants/product-variants.module';
import { ProductBundlesModule } from './modules/product-bundles/product-bundles.module';
import { CommissionsModule } from './modules/commissions/commissions.module';
import { TerritoriesModule } from './modules/territories/territories.module';
import { ChatterModule } from './modules/chatter/chatter.module';
import { EventsModule } from './modules/events/events.module';
import { ScimModule } from './modules/scim/scim.module';
import { WebauthnModule } from './modules/webauthn/webauthn.module';
import { AccessControlModule } from './modules/access-control/access-control.module';
import { SyncModule } from './modules/sync/sync.module';
import { PushModule } from './modules/push/push.module';

/**
 * Root NestJS module. Wires together every feature + infrastructure
 * module and installs the per-request tenant context middleware.
 *
 * Module groups:
 *   • infra/   — global, no business logic. PrismaModule (DB), QueueModule
 *                (BullMQ + Redis), StorageModule (MinIO). All three are
 *                @Global() so feature modules can inject their services
 *                without re-importing them.
 *   • modules/ — feature modules. Each owns its routes + business rules.
 *                AuthModule is the only one that touches Prisma directly
 *                (pre-tenant lookups by slug); the rest use runWithTenant().
 *
 * Cross-module dependencies (= what to look at if a feature breaks):
 *   - Notes/Attachments/Activities all share the polymorphic
 *     (subjectType, subjectId) pattern via SubjectResolver from
 *     ActivitiesModule. If a subject 404s but exists, check there first.
 *   - Importer pushes BullMQ jobs into the `import` queue (QueueModule)
 *     and the worker reads files from MinIO (StorageModule). Both must
 *     be up for an import to complete — see import.processor.ts.
 *   - Companies/Contacts/Clients all log into ActivitiesService on
 *     create/update/delete so the timeline works. Skipping this would
 *     leave gaps in the polymorphic timeline.
 *
 * Multi-tenant isolation has THREE layers (defense in depth):
 *   1. TenantContextMiddleware → reads JWT, sets AsyncLocalStorage ctx
 *   2. tenantExtension() Prisma extension → auto-injects tenantId on every
 *      query of tenant-scoped models (see infra/prisma/prisma.service.ts)
 *   3. Postgres RLS policies → final line of defense, enforced via
 *      `SET LOCAL ROLE app_user` inside runWithTenant()
 */
@Module({
  imports: [
    // Structured JSON logging with PII redaction. The redact list covers the
    // places PII or secrets commonly end up in request/response payloads so
    // access-logs never leak a password, JWT, or customer email.
    //
    // NOTE: Pino redact uses JSON-path-style patterns with wildcards. We cover:
    //   - Authorization/cookies/set-cookie headers (req + res)
    //   - any "password", "passwordHash", "totpSecret", "secret", "apiKey",
    //     "token", "refreshToken", "accessToken" at any depth in the body
    //   - the standard email + phone fields
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env['LOG_LEVEL'] ?? (process.env['NODE_ENV'] === 'production' ? 'info' : 'debug'),
        autoLogging: { ignore: (req) => req.url === '/metrics' || req.url === '/api/v1/metrics' },
        // M-2: derive req.id from the X-Request-Id header stamped by
        // RequestContextMiddleware. Pino then prints it on every log line,
        // which is how a human stitches a trace across API + worker.
        genReqId: (req, res) => {
          const hdr = (res.getHeader('X-Request-Id') as string | undefined)
            ?? (req.headers['x-request-id'] as string | undefined);
          return hdr ?? 'req_' + Math.random().toString(36).slice(2, 12);
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["set-cookie"]',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'req.body.totpCode',
            'req.body.refreshToken',
            'req.body.accessToken',
            'req.body.apiKey',
            'req.body.secret',
            'req.body.token',
            'req.body.email',
            'req.body.phone',
            'req.body.mobile',
            '*.password',
            '*.passwordHash',
            '*.totpSecret',
            '*.refreshToken',
            '*.accessToken',
            '*.apiKey',
            '*.secret',
          ],
          censor: '[REDACTED]',
        },
        // Keep request-id propagation on for traceability.
        customProps: () => ({ app: 'amass-api' }),
      },
    }),
    // Global rate limiting: 60 req/min by default; auth routes override to stricter limits.
    // The `strict-auth` named throttler provides a per-IP short-window hard cap
    // usable by credential-sensitive endpoints on top of the default.
    // skipIf: e2e tests hit auth endpoints many times from localhost — skip throttling
    // when NODE_ENV === 'test' so CI doesn't flake on 429s.
    ThrottlerModule.forRoot({
      throttlers: [
        { name: 'global', ttl: 60_000, limit: 60 },
        { name: 'strict-auth', ttl: 60_000, limit: 5 },
      ],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule,
    QueueModule,
    RedisModule,
    StorageModule,
    ActivitiesModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CompaniesModule,
    ContactsModule,
    ClientsModule,
    ImporterModule,
    NotesModule,
    AttachmentsModule,
    RemindersModule,
    PipelinesModule,
    DealsModule,
    TasksModule,
    EmailModule,
    EmailTrackingModule,
    CallsModule,
    AiModule,
    InvoicesModule,
    PaymentsModule,
    ProjectsModule,
    QuotesModule,
    EmailSequencesModule,
    ContactSegmentsModule,
    DuplicatesModule,
    ProductsModule,
    CustomFieldsModule,
    ApprovalsModule,
    SsoModule,
    WhatsappModule,
    AnafModule,
    CalendarModule,
    ReportBuilderModule,
    LeadScoringModule,
    PortalModule,
    NotificationsModule,
    ExportsModule,
    SmsModule,
    WebhooksModule,
    BillingModule,
    LeadsModule,
    ContractsModule,
    ForecastingModule,
    CasesModule,
    OrdersModule,
    CampaignsModule,
    CustomerSubscriptionsModule,
    ValidationRulesModule,
    FormulaFieldsModule,
    ProductVariantsModule,
    ProductBundlesModule,
    CommissionsModule,
    TerritoriesModule,
    ChatterModule,
    EventsModule,
    WorkflowsModule,
    ReportsModule,
    GdprModule,
    HealthModule,
    MetricsModule,
    SchedulerModule,
    // A/D/F scaffolds — see module-level comments for the roadmap.
    ScimModule,
    WebauthnModule,
    AccessControlModule,
    SyncModule,
    PushModule,
  ],
  providers: [
    // B-scaling: rate-limit per-tenant (and per-user when authed) instead of
    // per-IP so a single noisy tenant can't starve others and co-located
    // employees behind one NAT don't share a counter. Unauthenticated paths
    // fall back to IP-based limiting.
    { provide: APP_GUARD, useClass: TenantThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // RequestContextMiddleware runs FIRST so both tenant middleware and any
    // controller/service sees the requestId in ALS when they run. Order is
    // significant here: Nest applies middleware in the order they appear in
    // a single `.apply(...)` call, so stacking them in one call keeps the
    // order deterministic.
    consumer
      .apply(RequestContextMiddleware, TenantContextMiddleware)
      .forRoutes('*');
  }
}
