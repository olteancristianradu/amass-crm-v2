import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { loadEnv } from '../../config/env';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

/**
 * AuditModule — global, append-only security trail.
 *
 * Distinction from ActivitiesService:
 *   - AuditService = security-grade record (auth events, deletes, role
 *     changes, GDPR exports). Mandatory; if it can't write we should
 *     consider that an alarming condition. Stored in `audit_logs` table.
 *   - ActivitiesService = user-visible "what happened" feed for the
 *     timeline. Best-effort. Stored in `activities` table.
 *
 * Both are tenant-scoped. AuditService is called from auth, companies,
 * contacts, clients, notes, attachments, importer — anywhere we mutate
 * data or do a security-relevant action.
 */
@Global()
@Module({
  imports: [
    // AuditController guards routes with JwtAuthGuard, which depends on
    // JwtService. We can't import AuthModule here (circular dep), so we
    // register JwtModule directly with the same factory as AuthModule.
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return { secret: env.JWT_SECRET, signOptions: { expiresIn: env.JWT_ACCESS_TTL } };
      },
    }),
  ],
  controllers: [AuditController],
  providers: [AuditService, JwtAuthGuard],
  exports: [AuditService],
})
export class AuditModule {}
