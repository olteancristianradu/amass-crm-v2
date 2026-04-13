import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import twilio, { Twilio, validateRequest } from 'twilio';
import { loadEnv } from '../../config/env';

/**
 * Thin wrapper around the Twilio SDK. We keep all Twilio-touching code in
 * this class so:
 *  - Services depend on an interface, not the SDK directly (easy to mock)
 *  - Missing credentials fail loud ONCE at call time, not at module boot
 *    (the server must start even without TWILIO_* set, for local dev)
 *  - Signature verification lives next to the client that knows the token
 */
@Injectable()
export class TwilioClient {
  private readonly logger = new Logger(TwilioClient.name);
  private cached: Twilio | null = null;

  private getClient(): Twilio {
    if (this.cached) return this.cached;
    const env = loadEnv();
    if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
      throw new ServiceUnavailableException({
        code: 'TWILIO_NOT_CONFIGURED',
        message: 'Twilio credentials missing — set TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN',
      });
    }
    this.cached = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    return this.cached;
  }

  /**
   * Initiate an outbound call. Twilio will POST status updates to
   * {TWILIO_WEBHOOK_BASE_URL}/api/v1/calls/webhook/status and will play the
   * TwiML returned from /api/v1/calls/webhook/voice when the callee answers.
   */
  async createCall(params: {
    from: string;
    to: string;
    callId: string; // our internal call id, passed in statusCallback path for correlation
  }): Promise<{ sid: string }> {
    const env = loadEnv();
    if (!env.TWILIO_WEBHOOK_BASE_URL) {
      throw new ServiceUnavailableException({
        code: 'TWILIO_WEBHOOK_BASE_URL_MISSING',
        message: 'TWILIO_WEBHOOK_BASE_URL must be set to initiate outbound calls',
      });
    }
    const client = this.getClient();
    const base = env.TWILIO_WEBHOOK_BASE_URL.replace(/\/$/, '');
    const call = await client.calls.create({
      from: params.from,
      to: params.to,
      url: `${base}/api/v1/calls/webhook/voice?callId=${params.callId}`,
      statusCallback: `${base}/api/v1/calls/webhook/status?callId=${params.callId}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      statusCallbackMethod: 'POST',
      record: true,
      recordingStatusCallback: `${base}/api/v1/calls/webhook/recording?callId=${params.callId}`,
    });
    this.logger.log(`Twilio call created sid=${call.sid} callId=${params.callId}`);
    return { sid: call.sid };
  }

  /**
   * Verify an incoming Twilio webhook signature. Twilio signs every request
   * with HMAC-SHA1(authToken, url + sortedParams). If the request came from
   * anywhere else, reject. Returns false if misconfigured.
   */
  verifySignature(url: string, params: Record<string, string>, signature: string | undefined): boolean {
    if (!signature) return false;
    const env = loadEnv();
    if (!env.TWILIO_AUTH_TOKEN) {
      this.logger.warn('Skipping Twilio signature verification — TWILIO_AUTH_TOKEN not set');
      return false;
    }
    return validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
  }

  /**
   * Build the public URL a Twilio webhook was sent to. Twilio computes the
   * signature over the exact URL, so we must match: scheme + host + path
   * + query string. We trust `TWILIO_WEBHOOK_BASE_URL` as the canonical
   * externally-visible origin (behind ngrok / CDN / etc).
   */
  publicWebhookUrl(pathWithQuery: string): string {
    const env = loadEnv();
    const base = (env.TWILIO_WEBHOOK_BASE_URL ?? '').replace(/\/$/, '');
    return `${base}${pathWithQuery}`;
  }
}
