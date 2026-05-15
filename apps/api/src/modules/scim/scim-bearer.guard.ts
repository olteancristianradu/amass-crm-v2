import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { ScimTokenService } from './scim-token.service';

/**
 * Request shape after `ScimBearerGuard` runs. The guard mutates the request
 * to attach the resolved tenant; controllers read it via this type rather
 * than re-validating an `X-Tenant-Id` header.
 */
export type ScimAuthenticatedRequest = Request & {
  scimTenantId?: string;
  scimTokenId?: string;
};

/**
 * B3-PR3: NestJS guard that swaps the temporary `X-Tenant-Id` header path
 * for a real SCIM bearer-token check.
 *
 * Flow:
 *   1. Extract `Authorization: Bearer <token>` from the request.
 *   2. Hash + lookup via `ScimTokenService.verifyToken`.
 *   3. On success: attach `req.scimTenantId` (+ `scimTokenId` for audit) so
 *      the controller can call `prisma.runWithTenant(req.scimTenantId, ...)`.
 *   4. Emit an `scim.api_call` audit entry (best-effort; AuditService never
 *      throws). This is the security trail required by B3 — every SCIM hit
 *      is logged with action + path + token id.
 *
 * Why not reuse `JwtAuthGuard`: SCIM bearer tokens are NOT JWTs. They're
 * opaque random strings handed to a third-party IdP. They have no claims,
 * no expiry (revocation is explicit), and their `tenantId` is derived from
 * a DB row, not a signed payload.
 */
@Injectable()
export class ScimBearerGuard implements CanActivate {
  constructor(
    private readonly tokenService: ScimTokenService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<ScimAuthenticatedRequest>();
    const auth = req.headers.authorization;
    if (!auth || !auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException({ code: 'NO_TOKEN', message: 'Missing bearer token' });
    }
    // Slice the literal "Bearer " (case-insensitive: clients vary).
    const raw = auth.slice(7).trim();
    if (raw.length === 0) {
      throw new UnauthorizedException({ code: 'NO_TOKEN', message: 'Missing bearer token' });
    }

    const verified = await this.tokenService.verifyToken(raw);
    if (!verified) {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Bearer token invalid or revoked' });
    }

    req.scimTenantId = verified.tenantId;
    req.scimTokenId = verified.tokenId;

    // Best-effort audit. AuditService.log() swallows its own errors, so we
    // do not await — we keep the SCIM path fast. We log the HTTP method +
    // path so admins can reconstruct exactly what the IdP did.
    void this.audit.log({
      tenantId: verified.tenantId,
      action: 'scim.api_call',
      subjectType: 'scim_token',
      subjectId: verified.tokenId,
      metadata: {
        method: req.method,
        path: req.path ?? req.url,
      },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return true;
  }
}
