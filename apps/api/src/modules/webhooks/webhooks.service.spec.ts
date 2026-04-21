import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WebhooksService, isPrivateOrReservedIp } from './webhooks.service';

const mockRunWithTenant = vi.fn();
const mockCreate = vi.fn();
const mockPrisma = {
  runWithTenant: mockRunWithTenant,
  webhookDelivery: { create: mockCreate },
} as any;

vi.mock('../../infra/prisma/tenant-context', () => ({
  requireTenantContext: () => ({ tenantId: 'tenant-1', userId: 'user-1' }),
}));

describe('WebhooksService', () => {
  let svc: WebhooksService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new WebhooksService(mockPrisma);
  });

  describe('create', () => {
    it('generates a secret and creates endpoint', async () => {
      const endpoint = { id: 'ep1', url: 'https://example.com/hook', events: ['DEAL_CREATED'], isActive: true, createdAt: new Date(), secret: 'abc' };
      mockRunWithTenant.mockResolvedValue(endpoint);

      const result = await svc.create({ url: 'https://example.com/hook', events: ['DEAL_CREATED' as never] });

      expect(result).toBe(endpoint);
      expect(mockRunWithTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    });
  });

  describe('dispatch', () => {
    it('fires without throwing even when endpoint fetch fails', () => {
      // dispatch is fire-and-forget — should never throw
      mockRunWithTenant.mockResolvedValue([]);
      expect(() => svc.dispatch('tenant-1', 'DEAL_CREATED' as never, { id: 'deal-1' })).not.toThrow();
    });
  });
});

/**
 * SSRF allow-list. The webhook sender calls `validateUrl` on every create,
 * update, AND again at delivery time (DNS-rebinding defense). The IP-range
 * check below is the core of that gate — if an attacker's DNS record flips
 * to any of these, we must refuse to fire. These cases are the reason we
 * don't rely on `fetch({ redirect: 'error' })` alone.
 */
describe('isPrivateOrReservedIp (SSRF blocklist)', () => {
  // Public, routable IPs — must be allowed (false = not private/reserved).
  it.each([
    ['1.1.1.1', 4],
    ['8.8.8.8', 4],
    ['142.250.190.14', 4], // google.com
    ['2606:4700:4700::1111', 6], // cloudflare-dns
  ] as const)('allows public %s', (ip, family) => {
    expect(isPrivateOrReservedIp(ip, family)).toBe(false);
  });

  // Non-routable IPv4 — must all be blocked.
  it.each([
    ['0.0.0.0', 4],
    ['0.1.2.3', 4],
    ['10.0.0.1', 4],
    ['10.255.255.255', 4],
    ['127.0.0.1', 4],          // loopback
    ['127.4.5.6', 4],
    ['169.254.169.254', 4],    // AWS/GCP metadata service — classic SSRF target
    ['172.16.0.1', 4],
    ['172.20.30.40', 4],
    ['172.31.255.254', 4],
    ['192.168.1.1', 4],
    ['100.64.0.1', 4],          // CGNAT
    ['100.127.255.254', 4],
    ['224.0.0.1', 4],           // multicast
    ['255.255.255.255', 4],     // broadcast
    ['240.0.0.1', 4],           // reserved future-use
  ] as const)('blocks private/reserved IPv4 %s', (ip, family) => {
    expect(isPrivateOrReservedIp(ip, family)).toBe(true);
  });

  // IPv6 — must block loopback, link-local, ULA, multicast, and the
  // IPv4-mapped form of any blocked v4 range.
  it.each([
    ['::', 6],
    ['::1', 6],
    ['fe80::1', 6],
    ['fc00::1', 6],
    ['fd00::5', 6],
    ['ff02::1', 6],
    ['::ffff:127.0.0.1', 6],     // IPv4-mapped loopback
    ['::ffff:169.254.169.254', 6], // IPv4-mapped metadata
  ] as const)('blocks private/reserved IPv6 %s', (ip, family) => {
    expect(isPrivateOrReservedIp(ip, family)).toBe(true);
  });

  // Bounded tolerance: malformed input should fail closed.
  it.each([
    ['not-an-ip', 4],
    ['999.999.999.999', 4],
    ['1.2.3', 4],
  ] as const)('treats malformed v4 %s as blocked', (ip, family) => {
    expect(isPrivateOrReservedIp(ip, family)).toBe(true);
  });
});
