import { Module } from '@nestjs/common';
import { WsModule } from '../../infra/ws/ws.module';
import { AuthModule } from '../auth/auth.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { CallsWebhookController } from './calls-webhook.controller';
import { PhoneNumbersController } from './phone-numbers.controller';
import { PhoneNumbersService } from './phone-numbers.service';
import { TwilioClient } from './twilio.client';

/**
 * S12 Calls module. Provides:
 *   - Phone number CRUD (admin: register Twilio numbers)
 *   - Click-to-call (POST /calls/initiate)
 *   - Twilio webhooks (voice TwiML, status updates, recording ready)
 *   - S13 AI result ingestion (POST /calls/:id/ai-result)
 *
 * Depends on:
 *   - PrismaModule (global)   — DB access
 *   - QueueModule (global)    — BullMQ 'ai-calls' queue
 *   - ActivitiesModule (global) — timeline logging
 *   - AuditModule (global)    — audit log
 *   - WsModule                 — SyncPublisherService for call.completed (B1-PR2)
 */
@Module({
  imports: [AuthModule, WsModule],
  controllers: [CallsController, CallsWebhookController, PhoneNumbersController],
  providers: [CallsService, PhoneNumbersService, TwilioClient],
  exports: [CallsService],
})
export class CallsModule {}
