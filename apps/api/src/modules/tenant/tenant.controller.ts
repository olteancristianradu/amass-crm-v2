import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { UpdateTenantLocaleDto, UpdateTenantLocaleSchema } from './tenant.dto';
import { TenantService } from './tenant.service';

/**
 * Phase 0 / Feature 1 — tenant-wide settings (locale today; bigger surface
 * planned post-launch). Mounted under `/api/v1/tenant/*` — singular noun
 * because every call resolves to the caller's OWN tenant (`requireTenantContext`),
 * never an arbitrary tenant id.
 *
 * Cross-tenant attacks (T-I18N-I-02): a user authenticated to tenant A
 * who passes `?tenantId=B` would still operate on A because we never read
 * the id from the URL — we read it from the JWT/AsyncLocalStorage. The
 * route doesn't take a tenant id at all by design.
 */
@Controller('tenant')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TenantController {
  constructor(private readonly tenants: TenantService) {}

  /** GET /api/v1/tenant/locale — read default + enabled locale list. */
  @Get('locale')
  async getLocale() {
    return this.tenants.getLocaleConfig();
  }

  /**
   * PATCH /api/v1/tenant/locale — OWNER/ADMIN only. Updates default +
   * enabled list atomically; Zod enforces `defaultLocale ∈ enabledLocales`.
   */
  @Patch('locale')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async updateLocale(
    @Body(new ZodValidationPipe(UpdateTenantLocaleSchema)) dto: UpdateTenantLocaleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tenants.updateLocaleConfig(actor.userId, dto);
  }
}
