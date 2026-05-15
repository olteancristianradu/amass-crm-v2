import { describe, expect, it, vi } from 'vitest';
import { CallsWebhookController } from './calls-webhook.controller';
import type { CallsService } from './calls.service';

/**
 * Unauthenticated webhook surface. The signature/auth checks live INSIDE
 * CallsService (HMAC for Twilio, SystemApiKeyGuard for the AI worker).
 * The controller's job is just to extract the signature header + original
 * URL + callId query and pass them in.
 */

function makeSvc() {
  return {
    handleVoiceWebhook: vi.fn(),
    handleStatusWebhook: vi.fn(),
    handleRecordingWebhook: vi.fn(),
    saveAiResult: vi.fn(),
  };
}

function build(s: ReturnType<typeof makeSvc>) {
  return new CallsWebhookController(s as unknown as CallsService);
}

function fakeReq(sig: string | undefined, url: string) {
  return {
    headers: sig ? { 'x-twilio-signature': sig } : {},
    originalUrl: url,
  } as never;
}

describe('CallsWebhookController', () => {
  it('POST webhook/voice forwards body + signature + originalUrl to handleVoiceWebhook', async () => {
    const svc = makeSvc();
    svc.handleVoiceWebhook.mockResolvedValue('<Response/>');
    const ctrl = build(svc);

    const body = { From: '+40700', To: '+40711', CallSid: 'CA1' };
    const r = await ctrl.voiceWebhook(body, fakeReq('sigA', '/api/v1/calls/webhook/voice'));
    expect(svc.handleVoiceWebhook).toHaveBeenCalledWith(body, 'sigA', '/api/v1/calls/webhook/voice');
    expect(r).toBe('<Response/>');
  });

  it('POST webhook/voice tolerates a missing signature header (rejection happens in service)', async () => {
    const svc = makeSvc();
    svc.handleVoiceWebhook.mockResolvedValue('<Response/>');
    const ctrl = build(svc);

    await ctrl.voiceWebhook({}, fakeReq(undefined, '/api/v1/calls/webhook/voice'));
    expect(svc.handleVoiceWebhook).toHaveBeenCalledWith({}, undefined, '/api/v1/calls/webhook/voice');
  });

  it('POST webhook/status passes callId from the query string', async () => {
    const svc = makeSvc();
    svc.handleStatusWebhook.mockResolvedValue(undefined);
    const ctrl = build(svc);

    const body = { CallSid: 'CA1', CallStatus: 'completed' };
    await ctrl.statusWebhook(body, fakeReq('sigS', '/api/v1/calls/webhook/status?callId=c-1'), 'c-1');
    expect(svc.handleStatusWebhook).toHaveBeenCalledWith(
      body,
      'sigS',
      '/api/v1/calls/webhook/status?callId=c-1',
      'c-1',
    );
  });

  it('POST webhook/recording forwards body + signature + URL + callId', async () => {
    const svc = makeSvc();
    svc.handleRecordingWebhook.mockResolvedValue(undefined);
    const ctrl = build(svc);

    const body = { RecordingUrl: 'https://api.twilio.com/recording', RecordingSid: 'RE-x' };
    await ctrl.recordingWebhook(body, fakeReq('sigR', '/url?callId=c-2'), 'c-2');
    expect(svc.handleRecordingWebhook).toHaveBeenCalledWith(body, 'sigR', '/url?callId=c-2', 'c-2');
  });

  it('POST :id/ai-result forwards id + DTO to saveAiResult', async () => {
    const svc = makeSvc();
    svc.saveAiResult.mockResolvedValue({ ok: true });
    const ctrl = build(svc);

    const dto = {
      transcript: 'hello world',
      summary: 'short call',
      sentiment: 'POSITIVE',
      segments: [],
    };
    const r = await ctrl.saveAiResult('call-99', dto as never);
    expect(svc.saveAiResult).toHaveBeenCalledWith('call-99', dto);
    expect(r).toEqual({ ok: true });
  });
});
