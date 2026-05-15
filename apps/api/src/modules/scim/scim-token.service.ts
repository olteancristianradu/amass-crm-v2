import { createHash, randomBytes } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * B3-PR3: SCIM bearer-token lifecycle.
 *
 * GitHub Personal Access Token model:
 *   - `create()` generates a fresh 32-byte random string and returns it ONCE
 *     in plaintext. The operator copies it into Okta / Azure AD and we never
 *     see it again. The DB stores only SHA-256(raw).
 *   - `list()` returns the metadata (name, lastUsedAt, revokedAt) but never
 *     the raw or hashed token.
 *   - `revoke()` sets `revokedAt`; the verify path filters by `revokedAt IS NULL`
 *     so revocation is permanent.
 *   - `verifyToken()` is called by `ScimBearerGuard` on every SCIM request.
 *     On success it bumps `lastUsedAt` (fire-and-forget — a slow update must
 *     not block the SCIM call) and returns `{ tenantId, tokenId }`. On failure
 *     it returns null and the guard maps that to 401.
 *
 * Why SHA-256 (not bcrypt):
 *   - Bearer tokens are high-entropy (32 random bytes = 256 bits) so the
 *     attacker-resistance argument for slow hashes does not apply.
 *   - SHA-256 lets us index `tokenHash` for an O(log n) lookup per request
 *     (bcrypt would force a table scan because every row's hash has a
 *     different salt).
 *   - Same pattern as `PasswordResetToken` and `EmailVerificationToken`
 *     elsewhere in this repo.
 */
@Injectable()
export class ScimTokenService {
  /**
   * 32 random bytes → 43-char base64url string. ~256 bits of entropy, no
   * padding, URL-safe, never includes `=`/`+`/`/` so it survives copy-paste
   * across Okta / curl / shell.
   */
  static readonly TOKEN_BYTES = 32;

  constructor(private readonly prisma: PrismaService) {}

  /** SHA-256 hex of `raw`. Stable per input — no salt — so we can index it. */
  static hash(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  /**
   * Create a new SCIM token for `tenantId`. Returns the RAW token exactly
   * once (operator must store it now — we never display it again).
   */
  async create(
    tenantId: string,
    name: string,
  ): Promise<{ id: string; name: string; token: string; createdAt: Date }> {
    const raw = randomBytes(ScimTokenService.TOKEN_BYTES).toString('base64url');
    const tokenHash = ScimTokenService.hash(raw);
    const row = await this.prisma.runWithTenant(tenantId, async (tx) => {
      // tenantExtension stamps tenantId; cast for the same reason as
      // ScimService.createUser — Prisma's generated type can't see the
      // runtime extension's tenant injection.
      return tx.scimToken.create({
        data: { name, tokenHash } as unknown as {
          name: string;
          tokenHash: string;
          tenantId: string;
        },
      });
    });
    return { id: row.id, name: row.name, token: raw, createdAt: row.createdAt };
  }

  /**
   * List a tenant's SCIM tokens — metadata only, never the raw token or hash.
   * Includes revoked tokens (caller surfaces them so admins can audit).
   */
  async list(tenantId: string): Promise<
    Array<{
      id: string;
      name: string;
      createdAt: Date;
      lastUsedAt: Date | null;
      revokedAt: Date | null;
    }>
  > {
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const rows = await tx.scimToken.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
        revokedAt: r.revokedAt,
      }));
    });
  }

  /**
   * Revoke a token. Idempotent — calling on an already-revoked token returns
   * the existing `revokedAt`. 404 if the id doesn't belong to this tenant
   * (RLS + tenantExtension makes cross-tenant lookups impossible regardless).
   */
  async revoke(tenantId: string, id: string): Promise<{ id: string; revokedAt: Date }> {
    return this.prisma.runWithTenant(tenantId, async (tx) => {
      const existing = await tx.scimToken.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException({ code: 'NOT_FOUND', message: 'SCIM token not found' });
      if (existing.revokedAt) return { id: existing.id, revokedAt: existing.revokedAt };
      const updated = await tx.scimToken.update({
        where: { id },
        data: { revokedAt: new Date() },
      });
      // Non-null because we just set it.
      return { id: updated.id, revokedAt: updated.revokedAt as Date };
    });
  }

  /**
   * Verify a raw bearer token. Returns `{ tenantId, tokenId }` if valid +
   * not revoked, else `null`. Updates `lastUsedAt` on success.
   *
   * Cross-tenant safety: lookup is by `tokenHash` (globally unique), then we
   * read the row's `tenantId` from the row itself. There's no way for a
   * tenant-A token to satisfy a tenant-B SCIM call because tenantId is
   * derived from the token, not from a client-supplied header.
   *
   * NOT wrapped in `runWithTenant` because at this point we don't yet know
   * the tenant — the whole purpose of verify is to discover it. The lookup
   * uses the base Prisma client and hits the unique index; the subsequent
   * controller call enters `runWithTenant` with the resolved tenantId.
   */
  async verifyToken(raw: string): Promise<{ tenantId: string; tokenId: string } | null> {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const tokenHash = ScimTokenService.hash(raw);
    const row = await this.prisma.scimToken.findUnique({ where: { tokenHash } });
    if (!row) return null;
    if (row.revokedAt !== null) return null;
    // Best-effort lastUsedAt bump. We do NOT await this — a sluggish DB must
    // not slow down the SCIM request. The unique constraint on tokenHash means
    // there's no race risk: the row is fixed.
    void this.prisma.scimToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {
        /* logged via Prisma's own error path; swallow here so verify stays fast */
      });
    return { tenantId: row.tenantId, tokenId: row.id };
  }
}
