/**
 * SSRF defense for any outbound HTTP target the user can influence.
 *
 * Extracted from webhooks.service.ts during Phase 1 F3 (T-WH-S-02 review)
 * so other modules (SIEM forwarder, future custom HTTP actions) can reuse
 * the same blocklist without copy-pasting the regex jungle.
 *
 * Rules enforced by {@link validateUrl}:
 *   1. URL must parse and use http(s).
 *   2. HTTPS-only in production (http allowed in dev/test).
 *   3. No `user:pass@` userinfo (prevents some bypass tricks + accidental
 *      credential leakage to a logging proxy).
 *   4. Hostname must not match the operator's own deny list
 *      (WEBHOOK_HOST_DENYLIST + hardcoded `*.amass-crm.com` + `localhost`).
 *      Prevents the tenant from registering our internal hostnames.
 *   5. DNS A/AAAA records must all resolve to PUBLIC IPs. We re-check ALL
 *      records (not just the first) to defend against round-robin attacks
 *      where one record is public and a sibling is 127.0.0.1.
 *   6. The DNS resolution is PINNED — caller receives the resolved address
 *      so the HTTP request can connect to that IP directly and pass the
 *      original hostname as the Host header. This defeats DNS rebinding:
 *      the attacker's DNS can flip to 127.0.0.1 between this check and the
 *      request, but the request goes to the IP we already validated.
 *
 * NOT covered (out of scope, documented in T-WH-S-02 follow-up):
 *   - HTTP redirect following: the caller MUST set `redirect: 'error'` or
 *     re-validate the Location header. The pinned IP path uses node:http
 *     which doesn't auto-follow, so this is fine for the webhook delivery
 *     processor. Other callers using `fetch()` MUST pass `redirect: 'error'`.
 *   - DNS TTL caching: the kernel may cache; we accept the small race
 *     window because the pinned address neutralises a same-request flip.
 */
import { Injectable } from '@nestjs/common';
import { BadRequestException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';

export interface ValidatedUrl {
  parsed: URL;
  /**
   * Always set in production paths. UNDEFINED only in `NODE_ENV=test` where
   * we skip DNS to keep unit specs hermetic, OR when the hostname is in the
   * dev trusted list (WEBHOOK_TRUSTED_HOSTS). Callers that connect via
   * `fetch()` to `parsed.toString()` handle both cases; callers that want
   * to pin against a specific IP (the webhook delivery processor) MUST
   * fall back to plain fetch when this is undefined.
   */
  pinnedAddress?: { address: string; family: number };
}

/**
 * Hostnames we never want to deliver webhooks to. Operators add their own
 * via env (WEBHOOK_HOST_DENYLIST=internal.example.com,vault.example.com).
 * The hardcoded entries protect the platform itself.
 */
const HARDCODED_HOSTNAME_DENYLIST: ReadonlyArray<string | RegExp> = [
  'localhost',
  // Match anything under our own apex — prevents a tenant from registering
  // https://api.amass-crm.com/internal-route as a webhook target and looping
  // requests through our own ingress (which would be authenticated as them).
  /\.amass-crm\.com$/i,
  // Common internal infra DNS suffixes.
  /\.cluster\.local$/i,
  /\.internal$/i,
  /\.consul$/i,
];

@Injectable()
export class UrlValidatorService {
  /**
   * Throws BadRequestException with a stable user-facing message if the URL
   * fails any of the SSRF gates. Returns the parsed URL + pinned address on
   * success so a caller can pin its outbound HTTP request to the resolved IP.
   */
  async validateUrl(url: string): Promise<ValidatedUrl> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid URL');
    }

    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new BadRequestException('URL must use http(s)');
    }
    if (parsed.protocol === 'http:' && process.env['NODE_ENV'] === 'production') {
      throw new BadRequestException('URL must use HTTPS in production');
    }
    if (parsed.username || parsed.password) {
      throw new BadRequestException('URL must not contain credentials');
    }

    const hostname = parsed.hostname.toLowerCase();
    // Hardcoded + env-supplied deny list. Catches the platform's own apex,
    // common internal DNS suffixes, and operator-specified internal hosts.
    if (isHostnameDenied(hostname)) {
      throw new BadRequestException('URL host is not allowed');
    }
    const operatorDeny = (process.env['WEBHOOK_HOST_DENYLIST'] ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (operatorDeny.some((h) => hostname === h || hostname.endsWith(`.${h}`))) {
      throw new BadRequestException('URL host is not allowed');
    }

    // In test env, skip DNS lookups — tests use fake hostnames and asserting
    // SSRF behaviour on real DNS would make the suite flaky.
    if (process.env['NODE_ENV'] === 'test') return { parsed };

    // Dev escape hatch: comma-separated allow-list of hostnames whose
    // private/loopback resolution is acceptable. Use ONLY for the local
    // mock-services container (`webhook-mock` etc.) — prodOnlyChecks in
    // env.ts rejects any non-empty value in production.
    const trusted = (process.env['WEBHOOK_TRUSTED_HOSTS'] ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (trusted.includes(parsed.hostname)) return { parsed };

    let records: Array<{ address: string; family: number }>;
    try {
      records = await lookup(parsed.hostname, { all: true, verbatim: true });
    } catch {
      throw new BadRequestException('URL host cannot be resolved');
    }

    for (const rec of records) {
      if (isPrivateOrReservedIp(rec.address, rec.family)) {
        throw new BadRequestException('URL must resolve to a public address');
      }
    }

    return { parsed, pinnedAddress: records[0] };
  }
}

function isHostnameDenied(hostname: string): boolean {
  for (const rule of HARDCODED_HOSTNAME_DENYLIST) {
    if (typeof rule === 'string') {
      if (hostname === rule) return true;
    } else if (rule.test(hostname)) {
      return true;
    }
  }
  return false;
}

/**
 * Returns true if the IP is in a non-routable / metadata-sensitive range.
 * Covers IPv4 and IPv6. Blocks: loopback, link-local, private RFC1918,
 * carrier-grade NAT, AWS/GCP metadata (169.254.169.254), Azure IMDS
 * (168.63.129.16), ULA, ::1, IPv4-mapped private ranges.
 *
 * Exported for unit testing — webhooks.service.ts re-exports this from
 * here so any caller importing from webhooks gets the same predicate.
 */
export function isPrivateOrReservedIp(ip: string, family: number): boolean {
  if (family === 4) {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      return true; // malformed → fail closed
    }
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local + AWS/GCP metadata
    if (a === 168 && b === 63) return true; // 168.63.0.0/16 Azure DNS + IMDS host channel
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
    if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmarking
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return false;
  }
  // IPv6
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true; // link-local
  const firstByte = parseInt(lower.split(':')[0] || '0', 16);
  if ((firstByte & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((firstByte & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // IPv4-mapped (::ffff:a.b.c.d) — re-check as v4
  if (lower.startsWith('::ffff:')) {
    const v4 = lower.slice('::ffff:'.length);
    if (v4.includes('.')) return isPrivateOrReservedIp(v4, 4);
  }
  return false;
}
