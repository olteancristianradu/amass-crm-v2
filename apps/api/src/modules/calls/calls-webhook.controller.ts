import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { AiCallResultDto, AiCallResultSchema } from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SystemApiKeyGuard } from '../../common/guards/system-api-key.guard';
import { CallsService } from './calls.service';

/**
 * Unauthenticated webhook endpoints — called by Twilio or the internal
 * AI worker. No JwtAuthGuard here. Twilio webhooks are validated by
 * HMAC-SHA1 signature inside CallsService. The AI result endpoint uses
 * the SystemApiKeyGuard (static Bearer token).
 *
 *   POST   /calls/webhook/voice        Twilio: voice TwiML
 *   POST   /calls/webhook/status       Twilio: call status updates
 *   POST   /calls/webhook/recording    Twilio: recording ready
 *   POST   /calls/:id/ai-result        AI worker: transcript + summary
 */
@Controller('calls')
export class CallsWebhookController {
  constructor(private readonly calls: CallsService) {}

  /**
   * Twilio calls this URL when the callee answers (outbound) or when
   * one of our numbers receives a call (inbound). Must respond with TwiML.
   */
  @Post('webhook/voice')
  @HttpCode(200)
  @Header('Content-Type', 'text/xml')
  voiceWebhook(
    @Body() body: Record<string, string>,
    @Req() req: Request,
  ): string {
    const sig = req.headers['x-twilio-signature'] as string | undefined;
    return this.calls.handleVoiceWebhook(body, sig, req.originalUrl);
  }

  /**
   * Twilio calls this URL on every call status change.
   * `callId` is our internal id appended to the URL when the call was created.
   */
  @Post('webhook/status')
  @HttpCode(204)
  async statusWebhook(
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Query('callId') callId: string,
  ): Promise<void> {
    const sig = req.headers['x-twilio-signature'] as string | undefined;
    await this.calls.handleStatusWebhook(body, sig, req.originalUrl, callId);
  }

  /**
   * Twilio calls this URL when a recording is complete.
   * `callId` is our internal id appended to the URL when the call was created.
   */
  @Post('webhook/recording')
  @HttpCode(204)
  async recordingWebhook(
    @Body() body: Record<string, string>,
    @Req() req: Request,
    @Query('callId') callId: string,
  ): Promise<void> {
    const sig = req.headers['x-twilio-signature'] as string | undefined;
    await this.calls.handleRecordingWebhook(body, sig, req.originalUrl, callId);
  }

  /**
   * AI worker posts transcription + analysis results here.
   * Protected by SystemApiKeyGuard (AI_WORKER_SECRET Bearer token).
   */
  @Post(':id/ai-result')
  @UseGuards(SystemApiKeyGuard)
  saveAiResult(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AiCallResultSchema)) dto: AiCallResultDto,
  ) {
    return this.calls.saveAiResult(id, dto);
  }
}
