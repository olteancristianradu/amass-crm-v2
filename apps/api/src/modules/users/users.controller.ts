import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import {
  InviteUserDto,
  InviteUserSchema,
  UpdateMyLocaleDto,
  UpdateMyLocaleSchema,
  UpdateUserRoleDto,
  UpdateUserRoleSchema,
} from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async list() {
    return this.users.listForCurrentTenant();
  }

  /**
   * Minimal display-name lookup for the presence indicator. Open to all
   * authenticated roles because AGENT / VIEWER users also need to see who
   * else is on a record. Returns ONLY {id, fullName} — no email/role leak.
   *
   * Query format: `?ids=u1,u2,u3` (comma-separated). Max 100 ids per call.
   * Declared BEFORE @Get(':id') so the literal "lookup" doesn't match :id.
   */
  @Get('lookup')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  async lookup(@Query('ids') ids?: string) {
    const list = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return { data: await this.users.lookupDisplayNames(list) };
  }

  /**
   * Phase 0 / Feature 1 — locale switch.
   *
   * Open to every authenticated role (no `@Roles(...)`) because a user's
   * own locale is intrinsic to their account, not a tenant-admin decision.
   * The tenant admin still gates which locales are AVAILABLE via the
   * `Tenant.enabledLocales` list — service-layer enforces that.
   *
   * Declared BEFORE `@Get(':id')` so "me" doesn't get matched as `:id`.
   */
  @Patch('me/locale')
  async updateMyLocale(
    @Body(new ZodValidationPipe(UpdateMyLocaleSchema)) dto: UpdateMyLocaleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.updateMyLocale(actor.userId, dto.locale);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async getOne(@Param('id') id: string) {
    return this.users.getById(id);
  }

  /** Invite (create) a new user in the current tenant. */
  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async invite(
    @Body(new ZodValidationPipe(InviteUserSchema)) dto: InviteUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.invite(dto, actor.userId);
  }

  /** Change a user's role. OWNER-only for OWNER assignment. */
  @Patch(':id/role')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @RequireCedar({ action: 'user::update-role', resource: (req) => `User::${(req as { params: { id: string } }).params.id}` })
  async updateRole(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateUserRoleSchema)) dto: UpdateUserRoleDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.users.updateRole(id, dto, actor.role as UserRole, actor.userId);
  }

  /** Soft-delete a user — revokes all sessions, prevents further login. */
  @Delete(':id')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  @RequireCedar({ action: 'user::deactivate', resource: (req) => `User::${(req as { params: { id: string } }).params.id}` })
  async deactivate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.deactivate(id, actor.role as UserRole, actor.userId);
  }

  /** Re-activate a previously deactivated user. */
  @Post(':id/activate')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  async activate(@Param('id') id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.users.activate(id, actor.userId);
  }
}
