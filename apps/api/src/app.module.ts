import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { PrismaModule } from './infra/prisma/prisma.module';
import { QueueModule } from './infra/queue/queue.module';
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
import { CallsModule } from './modules/calls/calls.module';
import { EmailModule } from './modules/email/email.module';
import { NotesModule } from './modules/notes/notes.module';
import { PipelinesModule } from './modules/pipelines/pipelines.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { UsersModule } from './modules/users/users.module';

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
    PrismaModule,
    QueueModule,
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
    CallsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply tenant context to ALL routes. Routes without auth (login,
    // register, refresh) simply have an empty context — pre-auth Prisma
    // calls in AuthService bypass the auto-injection by being on a
    // non-tenant model (`tenant`) or by reading via unique secure keys.
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
