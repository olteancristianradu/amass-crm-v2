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

import { EmailTrackingService, signTrackingUrl, verifyTrackingSig, signOpenToken, verifyOpenToken, encodeUnsubscribeToken, decodeUnsubscribeToken } from './email-tracking.service';
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
    // Phase 1: pixel URL now carries an HMAC `?s=...` — assert the prefix.
    expect(out).toContain('<img src="https://api.example.com/api/v1/e/t/m-1/open.gif?s=');
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
    const sig = signOpenToken('m-1');
    const out = await h.svc.recordOpen('m-1', sig, '1.2.3.4', 'UA');
    expect(out.length).toBe(42);
    expect(h.tx.emailTrack.create).not.toHaveBeenCalled();
  });

  it('writes an OPEN row with ip + ua when message exists + sig valid', async () => {
    const h = build();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce({
      id: 'm-1',
      tenantId: 't-A',
    } as never);
    h.tx.emailTrack.create.mockResolvedValueOnce({});
    const sig = signOpenToken('m-1');
    await h.svc.recordOpen('m-1', sig, '1.2.3.4', 'UA-9');
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
    const sig = signOpenToken('m-1');
    const out = await h.svc.recordOpen('m-1', sig, null, null);
    expect(out.length).toBe(42);
  });

  // Phase 1 F1 / T-MAIL-S-01 — open-pixel HMAC defense.
  it('drops the DB write when open sig is missing under strict mode', async () => {
    const h = build();
    const out = await h.svc.recordOpen('m-1', null, '1.2.3.4', 'UA');
    expect(out.length).toBe(42);
    // Pixel still returned, but no message lookup happened.
    expect(h.prisma.emailMessage.findUnique).not.toHaveBeenCalled();
    expect(h.tx.emailTrack.create).not.toHaveBeenCalled();
  });

  it('drops the DB write when open sig is wrong (forgery attempt)', async () => {
    const h = build();
    const out = await h.svc.recordOpen('m-1', '0123456789abcdef', '1.2.3.4', 'UA');
    expect(out.length).toBe(42);
    expect(h.tx.emailTrack.create).not.toHaveBeenCalled();
  });

  it('accepts open without sig when EMAIL_TRACKING_REQUIRE_SIG=false', async () => {
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
    const out = await h.svc.recordOpen('m-1', null, null, null);
    expect(out.length).toBe(42);
    expect(h.tx.emailTrack.create).toHaveBeenCalled();
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

// Phase 1 F1 — open / unsubscribe HMAC helpers
describe('EmailTrackingService open + unsubscribe HMAC', () => {
  it('signOpenToken/verifyOpenToken roundtrip', () => {
    const sig = signOpenToken('msg-1');
    expect(sig).toMatch(/^[0-9a-f]{16}$/);
    expect(verifyOpenToken('msg-1', sig)).toBe(true);
    expect(verifyOpenToken('msg-2', sig)).toBe(false);
    expect(verifyOpenToken('msg-1', 'forged-bad-sig')).toBe(false);
  });

  it('open and click signatures are domain-separated (different prefixes)', () => {
    // Same input bytes, different domain prefix → different sigs. Prevents
    // an attacker who scraped a click sig from replaying it as an open sig.
    const openSig = signOpenToken('m-1');
    const clickSig = signTrackingUrl('m-1', 'https://x.com');
    expect(openSig).not.toBe(clickSig);
  });

  it('encodeUnsubscribeToken/decodeUnsubscribeToken roundtrip', () => {
    const token = encodeUnsubscribeToken('m-1', 'Foo@Bar.RO');
    const decoded = decodeUnsubscribeToken(token);
    expect(decoded).toEqual({ messageId: 'm-1', email: 'foo@bar.ro' });
  });

  it('decodeUnsubscribeToken returns null for malformed input', () => {
    expect(decodeUnsubscribeToken('not-base64!')).toBeNull();
    expect(decodeUnsubscribeToken('')).toBeNull();
    // Valid base64url but wrong structure
    expect(decodeUnsubscribeToken('aGVsbG8')).toBeNull();
  });

  it('decodeUnsubscribeToken rejects forged signature', () => {
    // Build a token with the right shape but a bad sig.
    const payload = 'm-1:foo@bar.ro:0123456789abcdef';
    const token = Buffer.from(payload, 'utf8').toString('base64url');
    expect(decodeUnsubscribeToken(token)).toBeNull();
  });

  it('decodeUnsubscribeToken handles emails containing ":" (RFC 5321 edge)', () => {
    const weirdEmail = 'foo:bar@baz.ro';
    const token = encodeUnsubscribeToken('m-X', weirdEmail);
    const decoded = decodeUnsubscribeToken(token);
    expect(decoded?.email).toBe(weirdEmail);
    expect(decoded?.messageId).toBe('m-X');
  });
});

// Phase 1 F1 — injectTracking now emits a pixel URL with `?s=<openSig>`
describe('EmailTrackingService.injectTracking pixel sig', () => {
  it('pixel URL carries an HMAC sig (?s=...)', () => {
    const out = build().svc.injectTracking('m-9', '<p>hi</p>');
    const expectedSig = signOpenToken('m-9');
    expect(out).toContain(`/e/t/m-9/open.gif?s=${expectedSig}`);
  });
});

// Phase 1 F1 — recordUnsubscribe + recordBounce
describe('EmailTrackingService.recordUnsubscribe', () => {
  function buildWithDeps() {
    const tx = {
      emailTrack: { create: vi.fn().mockResolvedValue({}) },
    };
    const prisma = {
      emailMessage: { findUnique: vi.fn() },
      runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as ConstructorParameters<typeof EmailTrackingService>[0];
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const suppression = {
      addSystem: vi.fn().mockResolvedValue({ emailMasked: 'f****@b****.ro' }),
    };
    const svc = new EmailTrackingService(prisma, audit as never, suppression as never);
    return { svc, prisma, tx, audit, suppression };
  }

  it('returns null on bad token', async () => {
    const h = buildWithDeps();
    expect(await h.svc.recordUnsubscribe('bad-token')).toBeNull();
    expect(h.suppression.addSystem).not.toHaveBeenCalled();
  });

  it('returns null when message missing', async () => {
    const h = buildWithDeps();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce(null);
    const token = encodeUnsubscribeToken('m-1', 'foo@bar.ro');
    expect(await h.svc.recordUnsubscribe(token)).toBeNull();
  });

  it('adds suppression + writes UNSUBSCRIBE row + audits + returns masked email', async () => {
    const h = buildWithDeps();
    vi.mocked(h.prisma.emailMessage.findUnique).mockResolvedValueOnce({
      id: 'm-1',
      tenantId: 't-A',
    } as never);
    const token = encodeUnsubscribeToken('m-1', 'foo@bar.ro');
    const out = await h.svc.recordUnsubscribe(token);
    expect(out?.emailMasked).toBe('f****@b****.ro');
    expect(h.suppression.addSystem).toHaveBeenCalledWith(
      't-A',
      'foo@bar.ro',
      'USER_UNSUBSCRIBE',
      'user:unsubscribe',
      expect.stringContaining('Unsubscribed via email link'),
    );
    const data = h.tx.emailTrack.create.mock.calls[0][0].data;
    expect(data.kind).toBe('UNSUBSCRIBE');
    expect(data.tenantId).toBe('t-A');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.unsubscribed', tenantId: 't-A' }),
    );
  });
});

describe('EmailTrackingService.recordBounce', () => {
  function buildWithDeps() {
    const tx = { emailTrack: { create: vi.fn().mockResolvedValue({}) } };
    const prisma = {
      emailMessage: { findUnique: vi.fn() },
      runWithTenant: vi.fn(async (_id: string, fn: (t: typeof tx) => unknown) => fn(tx)),
    } as unknown as ConstructorParameters<typeof EmailTrackingService>[0];
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const suppression = {
      addSystem: vi.fn().mockResolvedValue({ id: 's-1', emailMasked: 'a****@x****.ro' }),
    };
    const svc = new EmailTrackingService(prisma, audit as never, suppression as never);
    return { svc, tx, audit, suppression };
  }

  it('hard bounce → suppression + BOUNCE row + email.bounced audit', async () => {
    const h = buildWithDeps();
    const out = await h.svc.recordBounce('t-A', 'a@x.ro', 'hard', '550', 'm-1');
    expect(out.suppressed).toBe(true);
    expect(h.suppression.addSystem).toHaveBeenCalledWith(
      't-A',
      'a@x.ro',
      'BOUNCE_HARD',
      'webhook:bounce:hard',
      'code=550',
    );
    expect(h.tx.emailTrack.create.mock.calls[0][0].data.kind).toBe('BOUNCE');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.bounced' }),
    );
  });

  it('soft bounce → records BOUNCE row but no suppression', async () => {
    const h = buildWithDeps();
    const out = await h.svc.recordBounce('t-A', 'a@x.ro', 'soft', '421', 'm-1');
    expect(out.suppressed).toBe(false);
    expect(h.suppression.addSystem).not.toHaveBeenCalled();
    expect(h.tx.emailTrack.create.mock.calls[0][0].data.kind).toBe('BOUNCE');
  });

  it('spam complaint → suppression with reason=SPAM_REPORT + SPAM_REPORT row', async () => {
    const h = buildWithDeps();
    const out = await h.svc.recordBounce('t-A', 'a@x.ro', 'spam', null, 'm-1');
    expect(out.suppressed).toBe(true);
    expect(h.suppression.addSystem.mock.calls[0][2]).toBe('SPAM_REPORT');
    expect(h.tx.emailTrack.create.mock.calls[0][0].data.kind).toBe('SPAM_REPORT');
    expect(h.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email.spam_reported' }),
    );
  });
});

describe('EmailTrackingService.purgePiiBatch', () => {
  function buildWithDeps() {
    const prisma = {
      emailTrack: {
        findMany: vi.fn(),
        updateMany: vi.fn(),
      },
    } as unknown as ConstructorParameters<typeof EmailTrackingService>[0];
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const svc = new EmailTrackingService(prisma, audit as never);
    return { svc, prisma, audit };
  }

  it('returns 0 when nothing to purge', async () => {
    const h = buildWithDeps();
    vi.mocked(h.prisma.emailTrack.findMany).mockResolvedValueOnce([] as never);
    expect(await h.svc.purgePiiBatch(90, 1000)).toBe(0);
    expect(h.prisma.emailTrack.updateMany).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });

  it('nullifies ip + ua + stamps piiHashedAt for stale rows', async () => {
    const h = buildWithDeps();
    vi.mocked(h.prisma.emailTrack.findMany).mockResolvedValueOnce([
      { id: 'r1', tenantId: 't-A' },
      { id: 'r2', tenantId: 't-A' },
      { id: 'r3', tenantId: 't-B' },
    ] as never);
    vi.mocked(h.prisma.emailTrack.updateMany).mockResolvedValueOnce({ count: 3 } as never);
    const out = await h.svc.purgePiiBatch(90, 1000);
    expect(out).toBe(3);
    const args = vi.mocked(h.prisma.emailTrack.updateMany).mock.calls[0][0];
    expect(args.data).toMatchObject({ ipAddress: null, userAgent: null });
    expect(args.data.piiHashedAt).toBeInstanceOf(Date);
    expect((args.where as { id: { in: string[] } }).id.in).toEqual(['r1', 'r2', 'r3']);
  });

  it('emits one gdpr.pii.purged audit per tenant per batch', async () => {
    const h = buildWithDeps();
    vi.mocked(h.prisma.emailTrack.findMany).mockResolvedValueOnce([
      { id: 'r1', tenantId: 't-A' },
      { id: 'r2', tenantId: 't-A' },
      { id: 'r3', tenantId: 't-B' },
    ] as never);
    vi.mocked(h.prisma.emailTrack.updateMany).mockResolvedValueOnce({ count: 3 } as never);
    await h.svc.purgePiiBatch(90, 1000);
    expect(h.audit.log).toHaveBeenCalledTimes(2);
    const actions = vi.mocked(h.audit.log).mock.calls.map((c) => c[0]);
    expect(actions.every((a) => a.action === 'gdpr.pii.purged')).toBe(true);
    // count per tenant matches the candidates we set up.
    const byTenant = new Map(actions.map((a) => [a.tenantId, (a.metadata as { count: number }).count]));
    expect(byTenant.get('t-A')).toBe(2);
    expect(byTenant.get('t-B')).toBe(1);
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
