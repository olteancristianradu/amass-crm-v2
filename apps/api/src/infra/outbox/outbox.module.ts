/**
 * Outbox infrastructure module (Phase 1 F3).
 *
 * Wires:
 *   - OutboxService         publish API used by feature services
 *   - OutboxScheduler       installs the every-5s repeatable BullMQ job
 *   - OutboxPoller          consumes the tick, drains PENDING rows
 *   - WebhookDeliveryProcessor consumes per-(endpoint,event) delivery jobs
 *
 * Plus the helpers it depends on:
 *   - EnvelopeService       wraps/unwraps webhook secrets at rest
 *   - UrlValidatorService   SSRF gate, shared with WebhooksService
 *
 * @Global so any feature module can `inject OutboxService` without
 * having to import OutboxModule (matches the pattern set by PrismaModule).
 *
 * The poller is opt-out via the 'OUTBOX_POLL_ENABLED' provider: bind to
 * `false` in tests so vitest doesn't spawn a real BullMQ worker that
 * hammers Redis at 5s intervals during the suite.
 */
import { Global, Module } from '@nestjs/common';
import { EnvelopeService } from '../../common/crypto/envelope.service';
import { UrlValidatorService } from '../../common/ssrf/url-validator.service';
import { OutboxPoller } from './outbox.poller';
import { OutboxScheduler } from './outbox.scheduler';
import { OutboxService } from './outbox.service';
import { WebhookDeliveryProcessor } from './webhook-delivery.processor';

@Global()
@Module({
  providers: [
    OutboxService,
    OutboxScheduler,
    OutboxPoller,
    WebhookDeliveryProcessor,
    EnvelopeService,
    UrlValidatorService,
    {
      provide: 'OUTBOX_POLL_ENABLED',
      // Default to enabled when not under vitest; the e2e setup flips this
      // to false via process.env.OUTBOX_POLL_ENABLED='false'.
      useFactory: () => process.env['OUTBOX_POLL_ENABLED'] !== 'false',
    },
  ],
  exports: [OutboxService, EnvelopeService, UrlValidatorService],
})
export class OutboxModule {}
