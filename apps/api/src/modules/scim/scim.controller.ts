import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import {
  SCIM_ERROR_SCHEMA_URN,
  ScimListQuerySchema,
  ScimPatchRequestSchema,
  ScimUserCreateSchema,
  type ScimListQueryDto,
  type ScimPatchRequestDto,
  type ScimUserCreateDto,
} from './scim.dto';
import { ScimService } from './scim.service';

/**
 * SCIM 2.0 /Users CRUD (B3-PR1). Groups + bearer-token auth land in
 * subsequent PRs; for now the controller is `@Public()` and extracts the
 * acting tenant from the `X-Tenant-Id` header. **This is temporary** — once
 * B3-PR3 wires real bearer-token auth, the header path will be removed and
 * tenantId will be resolved from the provisioning token claim. Until then,
 * this controller must not be exposed on a public ingress.
 *
 * Hidden from Swagger because the surface targets IdP connectors (Okta,
 * Azure AD), not human consumers of our REST API.
 */
@ApiExcludeController()
@Controller('scim/v2')
@Public()
export class ScimController {
  constructor(private readonly scim: ScimService) {}

  @Get('Users')
  @Header('Content-Type', 'application/scim+json')
  async listUsers(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Query(new ZodValidationPipe(ScimListQuerySchema)) query: ScimListQueryDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(tenantId);
    return this.scim.listUsers(tid, query.startIndex, query.count, query.filter);
  }

  @Get('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  async getUser(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ): Promise<unknown> {
    const tid = this.requireTenant(tenantId);
    return this.scim.getUser(tid, id);
  }

  @Post('Users')
  @Header('Content-Type', 'application/scim+json')
  @HttpCode(HttpStatus.CREATED)
  async createUser(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Body(new ZodValidationPipe(ScimUserCreateSchema)) dto: ScimUserCreateDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(tenantId);
    return this.scim.createUser(tid, dto);
  }

  @Put('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  async replaceUser(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScimUserCreateSchema)) dto: ScimUserCreateDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(tenantId);
    return this.scim.replaceUser(tid, id, dto);
  }

  @Patch('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  async patchUser(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ScimPatchRequestSchema)) dto: ScimPatchRequestDto,
  ): Promise<unknown> {
    const tid = this.requireTenant(tenantId);
    return this.scim.patchUser(tid, id, dto.Operations);
  }

  @Delete('Users/:id')
  @Header('Content-Type', 'application/scim+json')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @Headers('x-tenant-id') tenantId: string | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    const tid = this.requireTenant(tenantId);
    await this.scim.deleteUser(tid, id);
  }

  /**
   * Tenant header gate. Throws a SCIM-shaped 400 if absent or blank.
   * Replaced by bearer-token tenant resolution in B3-PR3.
   */
  private requireTenant(tenantId: string | undefined): string {
    if (!tenantId || tenantId.trim() === '') {
      throw new BadRequestException({
        schemas: [SCIM_ERROR_SCHEMA_URN],
        detail: 'Missing X-Tenant-Id header',
        status: '400',
      });
    }
    return tenantId;
  }
}
