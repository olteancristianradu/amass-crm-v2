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
  CreateReminderDto,
  CreateReminderSchema,
  SubjectTypeDto,
  SubjectTypeSchema,
  UpdateReminderDto,
  UpdateReminderSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RemindersService } from './reminders.service';

/**
 * Polymorphic reminder routes. The `:subjectType` segment is normalised
 * via SubjectTypeSchema (uppercase enum), same convention as Notes.
 *
 * Routes:
 *   POST   /:subjectType/:subjectId/reminders     create + enqueue
 *   GET    /:subjectType/:subjectId/reminders     list for that subject
 *   GET    /reminders/me                          my upcoming PENDING list
 *   PATCH  /reminders/:id                         edit (re-enqueues if remindAt changed)
 *   POST   /reminders/:id/dismiss                 mark DISMISSED + cancel job
 *   DELETE /reminders/:id                         soft delete + cancel job
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class RemindersController {
  constructor(private readonly reminders: RemindersService) {}

  private parseSubject(raw: string): SubjectTypeDto {
    return SubjectTypeSchema.parse(raw.toUpperCase());
  }

  @Post(':subjectType/:subjectId/reminders')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
    @Body(new ZodValidationPipe(CreateReminderSchema)) dto: CreateReminderDto,
  ) {
    return this.reminders.create(this.parseSubject(subjectType), subjectId, dto);
  }

  @Get(':subjectType/:subjectId/reminders')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(
    @Param('subjectType') subjectType: string,
    @Param('subjectId') subjectId: string,
  ) {
    return this.reminders.listForSubject(this.parseSubject(subjectType), subjectId);
  }

  @Get('reminders/me')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  listMine(
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limitRaw: string | undefined,
    @Query('status') status: string | undefined,
  ) {
    const limit = Math.min(Math.max(Number(limitRaw) || 20, 1), 100);
    const reminderStatus = status === 'FIRED' ? 'FIRED' : 'PENDING';
    return this.reminders.listMine(cursor, limit, reminderStatus);
  }

  @Patch('reminders/:id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateReminderSchema)) dto: UpdateReminderDto,
  ) {
    return this.reminders.update(id, dto);
  }

  @Post('reminders/:id/dismiss')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  dismiss(@Param('id') id: string) {
    return this.reminders.dismiss(id);
  }

  @Delete('reminders/:id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  remove(@Param('id') id: string) {
    return this.reminders.remove(id);
  }
}
