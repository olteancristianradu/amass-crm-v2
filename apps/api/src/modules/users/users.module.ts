import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

/**
 * UsersModule — admin-facing user listing inside the current tenant.
 * Today: GET /users (OWNER/ADMIN/MANAGER only) returns the tenant's
 * user roster. The full invite/disable/role-change flow is intentionally
 * deferred — the user mgmt sprint isn't on the critical path yet.
 *
 * Created early so we can use the route as a canary in cross-tenant
 * isolation tests (it's the simplest "tenant-scoped read").
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule {}
