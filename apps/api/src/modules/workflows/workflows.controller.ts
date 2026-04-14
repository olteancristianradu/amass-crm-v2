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
import { UserRole } from '@prisma/client';
import {
  CreateWorkflowDto,
  CreateWorkflowSchema,
  ListWorkflowsQueryDto,
  ListWorkflowsQuerySchema,
  UpdateWorkflowDto,
  UpdateWorkflowSchema,
} from '@amass/shared';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WorkflowsService } from './workflows.service';

/**
 * Workflow CRUD + run management.
 *
 *   POST   /workflows              create
 *   GET    /workflows              list
 *   GET    /workflows/:id          detail (includes steps + last 20 runs)
 *   PATCH  /workflows/:id          update
 *   DELETE /workflows/:id          soft delete
 *   GET    /workflows/runs         list all runs (admin monitoring)
 *   DELETE /workflows/runs/:runId  cancel a running run
 */
@Controller('workflows')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  create(@Body(new ZodValidationPipe(CreateWorkflowSchema)) dto: CreateWorkflowDto) {
    return this.workflows.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListWorkflowsQuerySchema)) q: ListWorkflowsQueryDto) {
    return this.workflows.list(q);
  }

  @Get('runs')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  listRuns(@Query(new ZodValidationPipe(ListWorkflowsQuerySchema)) q: ListWorkflowsQueryDto) {
    return this.workflows.listRuns(q);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.workflows.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateWorkflowSchema)) dto: UpdateWorkflowDto,
  ) {
    return this.workflows.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN)
  remove(@Param('id') id: string) {
    return this.workflows.remove(id);
  }

  @Delete('runs/:runId/cancel')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  cancelRun(@Param('runId') runId: string) {
    return this.workflows.cancelRun(runId);
  }
}
