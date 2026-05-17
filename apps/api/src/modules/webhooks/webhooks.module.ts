import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

// Phase 1 F3: WebhooksService now depends on OutboxService + EnvelopeService
// + UrlValidatorService. All three live in the @Global() OutboxModule (wired
// from AppModule), so we don't import the module here — Nest resolves them
// from the global scope. Imports stay focused on the auth/permission stack
// the controller needs.
//
// Phase 1.1 HIGH-2: AuditModule added — webhook CRUD + secret rotate + auto-
// disable now emit audit rows (webhook.endpoint.*).
@Module({
  imports: [AuthModule, AccessControlModule, AuditModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
