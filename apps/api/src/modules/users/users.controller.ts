import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { InviteUserDto, InviteUserSchema, UpdateUserRoleDto, UpdateUserRoleSchema } from './users.dto';
import { UsersService } from './users.service';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  async list() {
    return this.users.listForCurrentTenant();
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
