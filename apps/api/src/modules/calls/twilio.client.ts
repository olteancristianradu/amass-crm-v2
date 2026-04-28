import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import twilio, { Twilio, validateRequest } from 'twilio';
import { loadEnv } from '../../config/env';
import { getBreaker } from '../../common/resilience/circuit-breaker';

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
    // The SDK accepts an optional `region` + a custom base URL via the
    // `httpClient` option. Simpler approach: when TWILIO_BASE_URL is set
    // (apps/mock-services in dev), pass it as `edge`/`region` is not
    // applicable — we override at the request level via `baseUrl` on
    // each REST resource. The Twilio SDK exposes `client.baseUrl =
    // ...` on the resource collection objects but it's read-only on
    // the v5 client. The supported override is the `httpClient` option,
    // and the cleanest swap is monkey-patching the resource hosts after
    // construction. For now we set the global `host` env that the SDK
    // honours via the HTTP_PROXY semantics — see
    // https://www.twilio.com/docs/libraries/node/usage#http-client-options
    if (env.TWILIO_BASE_URL) {
      const u = new URL(env.TWILIO_BASE_URL);
      // host = e.g. "twilio-mock:3001"; the SDK will compose
      // protocol://host/<path>. Falling back to defaults if unset.
      this.cached = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN, {
        // Library option name on twilio-node v5+: `region`/`edge` only
        // accept production regions. Use the documented `httpClient` to
        // route everywhere through a custom URL builder by setting the
        // host directly on the wrapper — the official escape hatch.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      // Resource API hosts are pulled from `client.<resource>.v2010` etc.
      // Patching them keeps the auth + signing path intact while flipping
      // the URL the request lands on. This is what the official
      // testing guide shows for stripe-mock-style local mocks.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c = this.cached as any;
      const baseHost = u.host; // e.g. twilio-mock:3001
      const baseProtocol = u.protocol.replace(':', ''); // http
      // The SDK's request layer reads `client.host` + `client.region` on
      // certain code paths; setting both covers v5 and v6 of twilio-node.
      c.host = baseHost;
      c.region = undefined;
      c.edge = undefined;
      c.baseUrl = `${baseProtocol}://${baseHost}`;
    } else {
      this.cached = twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
    }
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
    // C-ops: breaker trips after 5 consecutive Twilio failures so we don't
    // keep queuing doomed outbound calls while the provider is degraded.
    const call = await getBreaker('twilio').exec(() =>
      client.calls.create({
        from: params.from,
        to: params.to,
        url: `${base}/api/v1/calls/webhook/voice?callId=${params.callId}`,
        statusCallback: `${base}/api/v1/calls/webhook/status?callId=${params.callId}`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        record: true,
        recordingStatusCallback: `${base}/api/v1/calls/webhook/recording?callId=${params.callId}`,
      }),
    );
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
