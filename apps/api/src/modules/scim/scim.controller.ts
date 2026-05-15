import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ScimBearerGuard, type ScimAuthenticatedRequest } from './scim-bearer.guard';
import {
  ScimGroupCreateSchema,
  ScimGroupReplaceSchema,
  ScimListQuerySchema,
  ScimPatchRequestSchema,
  ScimUserCreateSchema,
  type ScimGroupReplaceDto,
  type ScimListQueryDto,
  type ScimPatchRequestDto,
  type ScimUserCreateDto,
} from './scim.dto';
import { ScimGroupsService } from './scim-groups.service';
import { ScimService } from './scim.service';

/**
 * SCIM 2.0 /Users + /Groups.
 *
 * **Auth (B3-PR3)**: the temporary `X-Tenant-Id` header is gone. Every route
 * is guarded by `ScimBearerGuard`, which verifies an `Authorization: Bearer <token>`
 * via `ScimTokenService`, binds the resolved tenantId onto the request, and
 * emits an `scim.api_call` audit entry. `@Public()` keeps the global
 * `JwtAuthGuard` from also trying to validate this request as a CRM-user
 * JWT — these are opaque SCIM bearer tokens, not signed JWTs.
 *
 * Hidden from Swagger because the surface targets IdP connectors (Okta,
 * Azure AD), not human consumers of our REST API.
 */
@ApiExcludeController()
@Controller('scim/v2')
@Public()
@UseGuards(ScimBearerGuard)
export class ScimController {
  constructor(
    private readonly scim: ScimService,
    private readonly groups: ScimGroupsService,
  ) {}

  @Get('Users')
  @Header('Content-Type', 'application/scim+json')
  async listUsers(
    @Req() req: ScimAuthenticatedRequest,
    @Query(new ZodValidationPipe(ScimListQuerySchema)) query: ScimListQueryDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(req);
    return this.scim.listUsers(tid, query.startIndex, query.count, query.filter);
  }

  @Get('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  async getUser(
    @Req() req: ScimAuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<unknown> {
    const tid = this.requireTenant(req);
    return this.scim.getUser(tid, id);
  }

  @Post('Users')
  @Header('Content-Type', 'application/scim+json')
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Req() req: ScimAuthenticatedRequest,
    @Body(new ZodValidationPipe(ScimUserCreateSchema)) dto: ScimUserCreateDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(req);
    return this.scim.createUser(tid, dto);
  }

  @Put('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  async replaceUser(
    @Req() req: ScimAuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScimUserCreateSchema)) dto: ScimUserCreateDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(req);
    return this.scim.replaceUser(tid, id, dto);
  }

  @Patch('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  async patchUser(
    @Req() req: ScimAuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScimPatchRequestSchema)) dto: ScimPatchRequestDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(req);
    return this.scim.patchUser(tid, id, dto.Operations);
  }

  @Delete('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @Req() req: ScimAuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<void> {
    const tid = this.requireTenant(req);
    await this.scim.deleteUser(tid, id);
  }

  // ─── /Groups (B3-PR2) ─────────────────────────────────────────────────────
  // Synthetic, role-derived: each tenant has 5 immutable groups whose
  // membership tracks `User.role`. POST and DELETE return 501 because the
  // RBAC enum is fixed; only GET / PATCH / PUT actually mutate state (via
  // User.role updates).

  @Get('Groups')
  @Header('Content-Type', 'application/scim+json')
  async listGroups(
    @Req() req: ScimAuthenticatedRequest,
    @Query(new ZodValidationPipe(ScimListQuerySchema)) query: ScimListQueryDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(req);
    return this.groups.listGroups(tid, query.startIndex, query.count, query.filter);
  }

  @Get('Groups/:id')
  @Header('Content-Type', 'application/scim+json')
  async getGroup(
    @Req() req: ScimAuthenticatedRequest,
    @Param('id') id: string,
  ): Promise<unknown> {
    const tid = this.requireTenant(req);
    return this.groups.getGroup(tid, id);
  }

  @Post('Groups')
  @Header('Content-Type', 'application/scim+json')
  async createGroup(
    @Req() req: ScimAuthenticatedRequest,
    // Validate the body so a malformed POST still gets 400 instead of 501 —
    // matches RFC 7644 (validation precedes capability checks).
    @Body(new ZodValidationPipe(ScimGroupCreateSchema)) _dto: unknown,
  ): Promise<never> {
    this.requireTenant(req);
    return this.groups.createGroup();
  }

  @Put('Groups/:id')
  @Header('Content-Type', 'application/scim+json')
  async replaceGroup(
    @Req() req: ScimAuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScimGroupReplaceSchema)) dto: ScimGroupReplaceDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(req);
    return this.groups.replaceGroupMembers(tid, id, dto);
  }

  @Patch('Groups/:id')
  @Header('Content-Type', 'application/scim+json')
  async patchGroup(
    @Req() req: ScimAuthenticatedRequest,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScimPatchRequestSchema)) dto: ScimPatchRequestDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(req);
    return this.groups.patchGroup(tid, id, dto.Operations);
  }

  @Delete('Groups/:id')
  @Header('Content-Type', 'application/scim+json')
  async deleteGroup(
    @Req() req: ScimAuthenticatedRequest,
    @Param('id') _id: string,
  ): Promise<never> {
    this.requireTenant(req);
    return this.groups.deleteGroup();
  }

  /**
   * Pull the tenantId injected by `ScimBearerGuard`. In production the guard
   * runs before any handler, so this should always succeed; the defensive
   * throw catches the case where the guard was misconfigured (e.g. someone
   * removed `@UseGuards(ScimBearerGuard)`) so we fail closed rather than
   * leaking cross-tenant data.
   */
  private requireTenant(req: ScimAuthenticatedRequest): string {
    if (!req.scimTenantId) {
      throw new UnauthorizedException({ code: 'NO_TENANT', message: 'Missing SCIM bearer auth' });
    }
    return req.scimTenantId;
  }
}
