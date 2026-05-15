import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import { z } from 'zod';
import { CurrentUser, type AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { ScimTokenService } from './scim-token.service';

const CreateBodySchema = z.object({
  name: z.string().min(1).max(100),
});

/**
 * B3-PR3: CRM-admin-facing CRUD for SCIM bearer tokens.
 *
 * Distinct from `ScimController`:
 *   - `ScimController` (under /scim/v2) is hit by IdPs (Okta, Azure AD) and
 *     authenticates via `ScimBearerGuard` (bearer token from this table).
 *   - `ScimAdminController` (under /scim/tokens) is hit by tenant OWNER/ADMIN
 *     users from the CRM UI and authenticates via the regular JWT guard.
 *
 * The two are deliberately split so a leaked SCIM bearer token can't be used
 * to mint MORE tokens — the management surface requires a human JWT.
 *
 * Hidden from Swagger because it's an internal admin surface, not a public
 * API contract.
 */
@ApiExcludeController()
@Controller('scim/tokens')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class ScimAdminController {
  constructor(
    private readonly tokens: ScimTokenService,
    private readonly audit: AuditService,
  ) {}

  /** List the current tenant's SCIM tokens (metadata only — never the raw token). */
  @Get()
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.tokens.list(user.tenantId);
  }

  /**
   * Create a new SCIM token for the current tenant. Returns the raw token
   * EXACTLY ONCE in the response body alongside a `warning` so the FE shows
   * a "store it now — won't be shown again" banner.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    const parsed = CreateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'INVALID_BODY',
        message: parsed.error.errors[0]?.message ?? 'Invalid body',
      });
    }
    const { name } = parsed.data;
    const result = await this.tokens.create(user.tenantId, name);
    // Audit the creation. We log id + name, NEVER the raw token.
    await this.audit.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'scim.token_created',
      subjectType: 'scim_token',
      subjectId: result.id,
      metadata: { name: result.name },
    });
    return {
      id: result.id,
      name: result.name,
      token: result.token,
      createdAt: result.createdAt,
      warning: 'Store this token now — it will not be shown again.',
    };
  }

  /**
   * Revoke a SCIM token. Idempotent. The verify path filters by
   * `revokedAt IS NULL`, so a revoked token is immediately rejected on the
   * next IdP call (no Redis blocklist needed).
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<void> {
    const result = await this.tokens.revoke(user.tenantId, id);
    await this.audit.log({
      tenantId: user.tenantId,
      actorId: user.userId,
      action: 'scim.token_revoked',
      subjectType: 'scim_token',
      subjectId: result.id,
      metadata: { revokedAt: result.revokedAt.toISOString() },
    });
  }
}
