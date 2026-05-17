import { beforeEach, describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { UrlValidatorService, isPrivateOrReservedIp } from './url-validator.service';

const ORIGINAL_ENV = { ...process.env };

function resetEnv(overrides: Record<string, string | undefined>): void {
  for (const k of Object.keys(process.env)) delete process.env[k];
  Object.assign(process.env, ORIGINAL_ENV);
  // process.env coerces `= undefined` to the literal string "undefined".
  // Use delete for unset semantics.
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('UrlValidatorService.validateUrl', () => {
  let svc: UrlValidatorService;

  beforeEach(() => {
    // Default to test env so DNS lookups are skipped.
    resetEnv({ NODE_ENV: 'test' });
    svc = new UrlValidatorService();
  });

  describe('schema gates', () => {
    it('rejects malformed URLs', async () => {
      await expect(svc.validateUrl('not-a-url')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects non-http(s) protocols', async () => {
      await expect(svc.validateUrl('ftp://example.com/hook')).rejects.toThrow(/http\(s\)/);
      await expect(svc.validateUrl('javascript:alert(1)')).rejects.toThrow(/http\(s\)/);
      await expect(svc.validateUrl('file:///etc/passwd')).rejects.toThrow(/http\(s\)/);
    });

    it('rejects HTTP in production', async () => {
      resetEnv({ NODE_ENV: 'production', WEBHOOK_TRUSTED_HOSTS: undefined });
      // We are now in production — but DNS lookup will run. Use a hostname
      // that resolves to a public IP. example.com is reserved per RFC 2606
      // but DOES resolve via real DNS. Use the operator-deny shortcut to
      // avoid actually hitting DNS — point at a banned host so we error
      // before the DNS lookup. Actually simpler: just assert the http check
      // by using a denied hostname which short-circuits before DNS.
      await expect(svc.validateUrl('http://localhost/x')).rejects.toThrow(/HTTPS/);
    });

    it('rejects URLs with userinfo', async () => {
      await expect(svc.validateUrl('https://user:pass@example.com/hook')).rejects.toThrow(/credentials/);
      await expect(svc.validateUrl('https://user@example.com/hook')).rejects.toThrow(/credentials/);
    });
  });

  describe('hostname denylist', () => {
    it('blocks localhost', async () => {
      await expect(svc.validateUrl('https://localhost/hook')).rejects.toThrow(/not allowed/);
    });

    it('blocks the platform apex *.amass-crm.com', async () => {
      await expect(svc.validateUrl('https://api.amass-crm.com/internal')).rejects.toThrow(/not allowed/);
      await expect(svc.validateUrl('https://anything.amass-crm.com/x')).rejects.toThrow(/not allowed/);
    });

    it('blocks *.cluster.local (k8s)', async () => {
      await expect(svc.validateUrl('https://kube-dns.kube-system.svc.cluster.local/x')).rejects.toThrow(/not allowed/);
    });

    it('blocks *.internal and *.consul', async () => {
      await expect(svc.validateUrl('https://vault.internal/x')).rejects.toThrow(/not allowed/);
      await expect(svc.validateUrl('https://api.consul/x')).rejects.toThrow(/not allowed/);
    });

    it('honours operator-supplied WEBHOOK_HOST_DENYLIST', async () => {
      resetEnv({ NODE_ENV: 'test', WEBHOOK_HOST_DENYLIST: 'private.example.com,vault.acme.io' });
      await expect(svc.validateUrl('https://private.example.com/x')).rejects.toThrow(/not allowed/);
      await expect(svc.validateUrl('https://vault.acme.io/x')).rejects.toThrow(/not allowed/);
      await expect(svc.validateUrl('https://api.vault.acme.io/x')).rejects.toThrow(/not allowed/);
    });

    it('case-insensitive hostname matching', async () => {
      await expect(svc.validateUrl('https://LocalHost/x')).rejects.toThrow(/not allowed/);
      await expect(svc.validateUrl('https://API.AMASS-CRM.COM/x')).rejects.toThrow(/not allowed/);
    });
  });

  describe('passthrough', () => {
    it('returns parsed URL for public-looking hostname in test mode (DNS skipped)', async () => {
      const r = await svc.validateUrl('https://example.com/hook');
      expect(r.parsed.hostname).toBe('example.com');
      expect(r.pinnedAddress).toBeUndefined();
    });

    it('honours WEBHOOK_TRUSTED_HOSTS in non-test', async () => {
      resetEnv({ NODE_ENV: 'development', WEBHOOK_TRUSTED_HOSTS: 'webhook-mock,other-mock' });
      const r = await svc.validateUrl('https://webhook-mock:3001/hook');
      expect(r.parsed.hostname).toBe('webhook-mock');
      expect(r.pinnedAddress).toBeUndefined();
    });
  });
});

describe('isPrivateOrReservedIp', () => {
  describe('IPv4 public — must allow', () => {
    it.each([
      ['1.1.1.1', 4],
      ['8.8.8.8', 4],
      ['142.250.190.14', 4], // google
      ['52.84.150.39', 4], // AWS CloudFront public
    ] as const)('allows %s', (ip, family) => {
      expect(isPrivateOrReservedIp(ip, family)).toBe(false);
    });
  });

  describe('IPv4 must block', () => {
    it.each([
      ['0.0.0.0', 4, 'unspecified'],
      ['0.1.2.3', 4, '0.0.0.0/8'],
      ['10.0.0.1', 4, 'RFC1918'],
      ['10.255.255.255', 4, 'RFC1918'],
      ['127.0.0.1', 4, 'loopback'],
      ['127.4.5.6', 4, 'loopback'],
      ['169.254.169.254', 4, 'AWS/GCP IMDS'],
      ['168.63.129.16', 4, 'Azure IMDS'], // Phase 1 F3 addition
      ['168.63.0.1', 4, 'Azure DNS'],
      ['172.16.0.1', 4, 'RFC1918'],
      ['172.31.255.254', 4, 'RFC1918'],
      ['192.168.1.1', 4, 'RFC1918'],
      ['192.0.0.1', 4, 'IETF protocol'], // Phase 1 F3 addition
      ['198.18.0.1', 4, 'benchmarking'], // Phase 1 F3 addition
      ['198.19.255.254', 4, 'benchmarking'],
      ['100.64.0.1', 4, 'CGNAT'],
      ['224.0.0.1', 4, 'multicast'],
      ['240.0.0.1', 4, 'reserved'],
    ] as const)('blocks %s (%s)', (ip, family, _label) => {
      expect(isPrivateOrReservedIp(ip, family)).toBe(true);
    });
  });

  describe('IPv6 must block', () => {
    it.each([
      ['::', 6],
      ['::1', 6],
      ['fe80::1', 6],
      ['fc00::1', 6],
      ['fd00::5', 6],
      ['ff02::1', 6],
      ['::ffff:127.0.0.1', 6], // IPv4-mapped loopback
      ['::ffff:169.254.169.254', 6], // IPv4-mapped AWS IMDS
      ['::ffff:168.63.129.16', 6], // IPv4-mapped Azure IMDS
    ] as const)('blocks %s', (ip, family) => {
      expect(isPrivateOrReservedIp(ip, family)).toBe(true);
    });
  });

  describe('malformed input', () => {
    it.each([
      ['not-an-ip', 4],
      ['999.999.999.999', 4],
      ['1.2.3', 4],
      ['', 4],
    ] as const)('treats malformed v4 %s as blocked', (ip, family) => {
      expect(isPrivateOrReservedIp(ip, family)).toBe(true);
    });
  });
});
