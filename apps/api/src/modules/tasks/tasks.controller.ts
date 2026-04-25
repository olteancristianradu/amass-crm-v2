import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateTaskDto,
  CreateTaskSchema,
  ListTasksQueryDto,
  ListTasksQuerySchema,
  UpdateTaskDto,
  UpdateTaskSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { CedarContextService } from '../access-control/cedar-context.service';
import { AuthenticatedUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { TasksService } from './tasks.service';

/**
 * Routes:
 *   POST   /tasks              create (link to deal OR subject, not both)
 *   GET    /tasks              list + filter
 *   GET    /tasks/me           shortcut: assigneeId = current user, status = OPEN
 *   GET    /tasks/:id          single task
 *   PATCH  /tasks/:id          update fields (NOT status)
 *   POST   /tasks/:id/complete → DONE + stamp completedAt
 *   POST   /tasks/:id/reopen   → OPEN + clear completedAt
 *   DELETE /tasks/:id          soft delete
 */
@Controller('tasks')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(@Body(new ZodValidationPipe(CreateTaskSchema)) dto: CreateTaskDto) {
    return this.tasks.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListTasksQuerySchema)) q: ListTasksQueryDto) {
    return this.tasks.list(q);
  }

  @Get('me')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(ListTasksQuerySchema)) q: ListTasksQueryDto,
  ) {
    // Override assignee/status with the "my tasks" preset. We still let
    // the caller pass cursor/limit/dueBefore through so the FE can
    // paginate and filter by "due in the next 7 days" etc.
    return this.tasks.list({
      ...q,
      assigneeId: user.userId,
      status: q.status ?? 'OPEN',
    });
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.tasks.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTaskSchema)) dto: UpdateTaskDto,
  ) {
    return this.tasks.update(id, dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  complete(@Param('id') id: string) {
    return this.tasks.complete(id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  reopen(@Param('id') id: string) {
    return this.tasks.reopen(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  // AGENT users can only delete tasks assigned to them — the async context
  // callback looks up Task.assigneeId and Cedar's policy rejects a write
  // from AGENT when isOwner !== true. OWNER/ADMIN/MANAGER bypass via role.
  @RequireCedar({
    action: 'task::delete',
    resource: (req) => `Task::${(req as { params: { id: string } }).params.id}`,
    context: CedarContextService.ownerOf('task'),
  })
  remove(@Param('id') id: string) {
    return this.tasks.remove(id);
  }
}
