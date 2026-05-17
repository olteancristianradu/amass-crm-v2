import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

// Phase 1 F3: WebhooksService now depends on OutboxService + EnvelopeService
// + UrlValidatorService. All three live in the @Global() OutboxModule (wired
// from AppModule), so we don't import the module here — Nest resolves them
// from the global scope. Imports stay focused on the auth/permission stack
// the controller needs.
@Module({
  imports: [AuthModule, AccessControlModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
