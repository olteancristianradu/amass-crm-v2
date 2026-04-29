import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundException } from '@nestjs/common';

vi.mock('../../config/env', () => ({
  loadEnv: vi.fn(() => ({
    PUBLIC_API_BASE_URL: 'https://api.example.com',
    TWILIO_WEBHOOK_BASE_URL: undefined,
    JWT_SECRET: 'test-secret-for-email-tracking-spec-only',
    EMAIL_TRACKING_REQUIRE_SIG: 'true',
  })),
}));

import { EmailTrackingService, signTrackingUrl, verifyTrackingSig } from './email-tracking.service';
import { loadEnv } from '../../config/env';

function build() {
  const tx = {
    emailTrack: {
      create: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  const prisma = {
    emailMessage: { findUnique: vi.fn() },
    runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  } as unknown as ConstructorParameters<typeof EmailTrackingService>[0];
  const svc = new EmailTrackingService(prisma);
  return { svc, prisma, tx };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  vi.mocked(loadEnv).mockReturnValue({
    PUBLIC_API_BASE_URL: 'https://api.example.com',
    TWILIO_WEBHOOK_BASE_URL: undefined,
    JWT_SECRET: 'test-secret-for-email-tracking-spec-only',
    EMAIL_TRACKING_REQUIRE_SIG: 'true',
  } as never);
});

describe('EmailTrackingService.publicBaseUrl', () => {
  it('appends /api/v1 when PUBLIC_API_BASE_URL is host-only', () => {
    expect(build().svc.publicBaseUrl()).toBe('https://api.example.com/api/v1');
  });

  it('preserves /api/v1 when already present', () => {
    vi.mocked(loadEnv).mockReturnValueOnce({
      PUBLIC_API_BASE_URL: 'https://api.example.com/api/v1/',
    } as never);
    expect(build().svc.publicBaseUrl()).toBe('https://api.example.com/api/v1');
  });

  it('falls back to TWILIO_WEBHOOK_BASE_URL when PUBLIC_API_BASE_URL is missing', () => {
    vi.mocked(loadEnv).mockReturnValueOnce({
      TWILIO_WEBHOOK_BASE_URL: 'https://twilio.example.com',
    } as never);
    expect(build().svc.publicBaseUrl()).toBe('https://twilio.example.com/api/v1');
  });

  it('returns null when neither env var is set', () => {
    vi.mocked(loadEnv).mockReturnValueOnce({} as never);
    expect(build().svc.publicBaseUrl()).toBeNull();
  });
});

describe('EmailTrackingService.injectTracking', () => {
  it('returns html unchanged when publicBaseUrl is null', () => {
    vi.mocked(loadEnv).mockReturnValueOnce({} as never);
    const html = '<a href="https://x.com">x</a>';
    expect(build().svc.injectTracking('m-1', html)).toBe(html);
  });

  it('rewrites every http(s) anchor through /e/t/:id/click and appends a 1x1 pixel', () => {
    const html = '<a href="https://example.com">e</a><a href="http://x.com/p">x</a>';
    const out = build().svc.injectTracking('m-1', html);
    expect(out).toContain(
      'https://api.example.com/api/v1/e/t/m-1/click?u=https%3A%2F%2Fexample.com',
    );
    expect(out).toContain(
      'https://api.example.com/api/v1/e/t/m-1/click?u=http%3A%2F%2Fx.com%2Fp',
    );
    expect(out).toContain('<img src="https://api.example.com/api/v1/e/t/m-1/open.gif"');
  });

  it('leaves mailto / tel / fragment-only anchors alone', () => {
    const html =
      '<a href="mailto:x@y.ro">m</a><a href="tel:+40">t</a><a href="#section">s</a>';
    const out = build().svc.injectTracking('m-1', html);
    // None of those three were rewritten — the original href values still appear unchanged.
    expect(out).toContain('href="mailto:x@y.ro"');
    expect(out).toContain('href="tel:+40"');
    expect(out).toContain('href="#section"');
  });
});

describe('EmailTrackingService.recordOpen', () => {
  it('returns the 1x1 GIF (42 bytes) regardless of message existence', async () => {
    const h = build();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce(null);
    const out = await h.svc.recordOpen('m-1', '1.2.3.4', 'UA');
    expect(out.length).toBe(42);
    expect(h.tx.emailTrack.create).not.toHaveBeenCalled();
  });

  it('writes an OPEN row with ip + ua when message exists', async () => {
    const h = build();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce({
      id: 'm-1',
      tenantId: 't-A',
    } as never);
    h.tx.emailTrack.create.mockResolvedValueOnce({});
    await h.svc.recordOpen('m-1', '1.2.3.4', 'UA-9');
    const data = h.tx.emailTrack.create.mock.calls[0][0].data;
    expect(data.kind).toBe('OPEN');
    expect(data.ipAddress).toBe('1.2.3.4');
    expect(data.userAgent).toBe('UA-9');
    expect(data.tenantId).toBe('t-A');
  });

  it('swallows DB failures (tracking must never break delivery UX)', async () => {
    const h = build();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce({
      id: 'm-1',
      tenantId: 't-A',
    } as never);
    h.tx.emailTrack.create.mockRejectedValueOnce(new Error('boom'));
    const out = await h.svc.recordOpen('m-1', null, null);
    expect(out.length).toBe(42);
  });
});

describe('EmailTrackingService.recordClick', () => {
  it('returns null for a non-http URL (refuses javascript: + data: + tel:)', async () => {
    const h = build();
    const sig1 = signTrackingUrl('m-1', 'javascript:alert(1)');
    const sig2 = signTrackingUrl('m-1', 'data:text/html,xx');
    expect(await h.svc.recordClick('m-1', 'javascript:alert(1)', sig1, null, null)).toBeNull();
    expect(await h.svc.recordClick('m-1', 'data:text/html,xx', sig2, null, null)).toBeNull();
    expect(h.prisma.emailMessage.findUnique).not.toHaveBeenCalled();
  });

  it('returns null when message is missing', async () => {
    const h = build();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce(null);
    const sig = signTrackingUrl('m-1', 'https://x.com');
    expect(await h.svc.recordClick('m-1', 'https://x.com', sig, null, null)).toBeNull();
  });

  it('still redirects on DB failure (tracking failure should NOT brick links)', async () => {
    const h = build();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce({
      id: 'm-1',
      tenantId: 't-A',
    } as never);
    h.tx.emailTrack.create.mockRejectedValueOnce(new Error('boom'));
    const sig = signTrackingUrl('m-1', 'https://x.com');
    expect(await h.svc.recordClick('m-1', 'https://x.com', sig, null, null)).toBe('https://x.com');
  });

  it('happy path returns the target URL after writing CLICK row', async () => {
    const h = build();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce({
      id: 'm-1',
      tenantId: 't-A',
    } as never);
    h.tx.emailTrack.create.mockResolvedValueOnce({});
    const sig = signTrackingUrl('m-1', 'https://example.com');
    expect(await h.svc.recordClick('m-1', 'https://example.com', sig, '1.2.3.4', 'UA'))
      .toBe('https://example.com');
    const data = h.tx.emailTrack.create.mock.calls[0][0].data;
    expect(data.kind).toBe('CLICK');
    expect(data.url).toBe('https://example.com');
  });

  // ─── Open redirect defense — F1.7 from /cso security audit ─────────────
  it('rejects click with NO signature when EMAIL_TRACKING_REQUIRE_SIG=true (default)', async () => {
    const h = build();
    expect(await h.svc.recordClick('m-1', 'https://x.com', null, null, null)).toBeNull();
    expect(h.prisma.emailMessage.findUnique).not.toHaveBeenCalled();
  });

  it('rejects click with WRONG signature (forged URL attack)', async () => {
    const h = build();
    // Attacker knows messageId, crafts ?u=https://phishing.com but cannot forge
    // the HMAC sig without our JWT_SECRET.
    expect(await h.svc.recordClick('m-1', 'https://phishing.com', 'forged-bad-sig', null, null))
      .toBeNull();
  });

  it('rejects click where signature was generated for a DIFFERENT URL', async () => {
    const h = build();
    const realSig = signTrackingUrl('m-1', 'https://example.com');
    // Attacker captures sig from one link, tries to use it with a different URL
    expect(await h.svc.recordClick('m-1', 'https://phishing.com', realSig, null, null))
      .toBeNull();
  });

  it('rejects click where signature was generated for a DIFFERENT messageId', async () => {
    const h = build();
    const sigForOtherMsg = signTrackingUrl('m-OTHER', 'https://example.com');
    expect(await h.svc.recordClick('m-1', 'https://example.com', sigForOtherMsg, null, null))
      .toBeNull();
  });

  it('allows click without signature when EMAIL_TRACKING_REQUIRE_SIG=false (backward compat)', async () => {
    const h = build();
    vi.mocked(loadEnv).mockReturnValueOnce({
      PUBLIC_API_BASE_URL: 'https://api.example.com',
      TWILIO_WEBHOOK_BASE_URL: undefined,
      JWT_SECRET: 'test-secret-for-email-tracking-spec-only',
      EMAIL_TRACKING_REQUIRE_SIG: 'false',
    } as never);
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce({
      id: 'm-1',
      tenantId: 't-A',
    } as never);
    h.tx.emailTrack.create.mockResolvedValueOnce({});
    expect(await h.svc.recordClick('m-1', 'https://x.com', null, null, null)).toBe('https://x.com');
  });
});

describe('EmailTrackingService HMAC sign/verify', () => {
  it('signTrackingUrl produces deterministic 16-char hex output', () => {
    const sig1 = signTrackingUrl('msg-1', 'https://example.com');
    const sig2 = signTrackingUrl('msg-1', 'https://example.com');
    expect(sig1).toBe(sig2);
    expect(sig1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('different messageId produces different sig', () => {
    expect(signTrackingUrl('msg-1', 'https://x.com')).not.toBe(signTrackingUrl('msg-2', 'https://x.com'));
  });

  it('different URL produces different sig', () => {
    expect(signTrackingUrl('msg-1', 'https://x.com')).not.toBe(signTrackingUrl('msg-1', 'https://y.com'));
  });

  it('verifyTrackingSig returns true for matching sig', () => {
    const sig = signTrackingUrl('msg-1', 'https://x.com');
    expect(verifyTrackingSig('msg-1', 'https://x.com', sig)).toBe(true);
  });

  it('verifyTrackingSig returns false for mismatched sig', () => {
    expect(verifyTrackingSig('msg-1', 'https://x.com', '0123456789abcdef')).toBe(false);
  });

  it('verifyTrackingSig handles malformed input without throwing', () => {
    expect(verifyTrackingSig('msg-1', 'https://x.com', 'not-hex-zzzz')).toBe(false);
    expect(verifyTrackingSig('msg-1', 'https://x.com', '')).toBe(false);
  });
});

describe('EmailTrackingService.statsForMessage', () => {
  it('throws EMAIL_NOT_FOUND when message is missing', async () => {
    const h = build();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce(null);
    await expect(h.svc.statsForMessage('m-1')).rejects.toThrow(NotFoundException);
  });

  it('returns opens + clicks counts + lastOpenedAt timestamp', async () => {
    const h = build();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce({
      id: 'm-1',
      tenantId: 't-A',
    } as never);
    h.tx.emailTrack.count
      .mockResolvedValueOnce(7) // opens
      .mockResolvedValueOnce(3); // clicks
    h.tx.emailTrack.findFirst.mockResolvedValueOnce({
      createdAt: new Date('2026-04-27T10:00:00Z'),
    });
    const out = await h.svc.statsForMessage('m-1');
    expect(out.opens).toBe(7);
    expect(out.clicks).toBe(3);
    expect(out.lastOpenedAt?.toISOString()).toBe('2026-04-27T10:00:00.000Z');
  });
});
