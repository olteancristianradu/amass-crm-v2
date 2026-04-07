import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantContextMiddleware } from './common/middleware/tenant-context.middleware';
import { PrismaModule } from './infra/prisma/prisma.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [PrismaModule, AuditModule, AuthModule, UsersModule],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply tenant context to ALL routes. Routes without auth simply have no context.
    consumer.apply(TenantContextMiddleware).forRoutes('*');
  }
}
