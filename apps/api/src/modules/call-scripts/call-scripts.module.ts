/**
 * Per-tenant default call script — the list of points the agent should hit
 * on a sales/support call. Read by the recording webhook handler when
 * enqueuing the AI job; the worker then runs script-compliance evaluation.
 *
 * Stored as JSON array on `tenants.defaultCallScript` (added by migration
 * `20260514220000_tenant_default_call_script`).
 */
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CallScriptsController } from './call-scripts.controller';
import { CallScriptsService } from './call-scripts.service';

@Module({
  imports: [AuthModule],
  controllers: [CallScriptsController],
  providers: [CallScriptsService],
  exports: [CallScriptsService],
})
export class CallScriptsModule {}
