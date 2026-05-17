import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailTrackingController } from './email-tracking.controller';
import { EmailTrackingService } from './email-tracking.service';

function build() {
  const tracking = {
    recordOpen: vi.fn().mockResolvedValue(Buffer.alloc(42)),
    recordClick: vi.fn(),
    recordUnsubscribe: vi.fn(),
    statsForMessage: vi.fn(),
  };
  const ctrl = new EmailTrackingController(tracking as unknown as EmailTrackingService);
  return { ctrl, tracking };
}

function mockResponse() {
  const headers: Record<string, string> = {};
  const res = {
    status: vi.fn().mockReturnThis(),
    setHeader: vi.fn((k: string, v: string) => {
      headers[k] = v;
      return res;
    }),
    end: vi.fn(),
    send: vi.fn(),
    redirect: vi.fn(),
    json: vi.fn(),
    _headers: headers,
  };
  return res;
}

function mockReq(opts: { ip?: string; ua?: string } = {}) {
  return {
    ip: opts.ip ?? '1.2.3.4',
    headers: {
      'user-agent': opts.ua ?? 'UA-test',
    },
  } as never;
}

beforeEach(() => vi.clearAllMocks());

describe('EmailTrackingController.open', () => {
  it('forwards `s` query param to recordOpen + returns the pixel bytes', async () => {
    const h = build();
    const req = mockReq();
    const res = mockResponse();
    await h.ctrl.open('m-1', 'abcdef0123456789', req, res as never);
    expect(h.tracking.recordOpen).toHaveBeenCalledWith('m-1', 'abcdef0123456789', '1.2.3.4', 'UA-test');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._headers['Content-Type']).toBe('image/gif');
  });

  it('passes null sig when query missing (service handles strict-mode drop)', async () => {
    const h = build();
    await h.ctrl.open('m-1', undefined, mockReq(), mockResponse() as never);
    expect(h.tracking.recordOpen).toHaveBeenCalledWith('m-1', null, '1.2.3.4', 'UA-test');
  });
});

describe('EmailTrackingController.click', () => {
  it('redirects 302 to the target URL on success', async () => {
    const h = build();
    h.tracking.recordClick.mockResolvedValueOnce('https://example.com');
    const res = mockResponse();
    await h.ctrl.click('m-1', 'https://example.com', 'sig123', mockReq(), res as never);
    expect(res.redirect).toHaveBeenCalledWith(302, 'https://example.com');
  });

  it('returns 404 JSON when recordClick returns null (bad sig / missing message)', async () => {
    const h = build();
    h.tracking.recordClick.mockResolvedValueOnce(null);
    const res = mockResponse();
    await h.ctrl.click('m-1', 'https://example.com', null as unknown as string, mockReq(), res as never);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'TRACKING_LINK_INVALID' }),
    );
  });
});

describe('EmailTrackingController.unsubscribe', () => {
  it('renders 200 RO/EN HTML on success containing the masked email', async () => {
    const h = build();
    h.tracking.recordUnsubscribe.mockResolvedValueOnce({ emailMasked: 'a****@x****.ro' });
    const res = mockResponse();
    await h.ctrl.unsubscribe('valid-token', res as never);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res._headers['Content-Type']).toBe('text/html; charset=utf-8');
    const html = (res.send.mock.calls[0][0] as string);
    expect(html).toContain('Dezabonare confirmată');
    expect(html).toContain('Unsubscribed');
    expect(html).toContain('a****@x****.ro');
  });

  it('renders 404 HTML on bad token (no detail leaked)', async () => {
    const h = build();
    h.tracking.recordUnsubscribe.mockResolvedValueOnce(null);
    const res = mockResponse();
    await h.ctrl.unsubscribe('bad', res as never);
    expect(res.status).toHaveBeenCalledWith(404);
    const html = (res.send.mock.calls[0][0] as string);
    expect(html).toContain('Link invalid sau expirat');
    expect(html).toContain('Invalid or expired link');
  });

  it('escapes HTML in the masked email rendering (defense vs odd masks)', async () => {
    const h = build();
    h.tracking.recordUnsubscribe.mockResolvedValueOnce({ emailMasked: '<script>x</script>' });
    const res = mockResponse();
    await h.ctrl.unsubscribe('valid', res as never);
    const html = res.send.mock.calls[0][0] as string;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
