import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import {
  CreateAttendeeSchema,
  CreateEventSchema,
  UpdateAttendeeStatusSchema,
  UpdateEventSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { EventsService } from './events.service';

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(@Body(new ZodValidationPipe(CreateEventSchema)) body: Parameters<EventsService['create']>[0]) {
    return this.events.create(body);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findAll() {
    return this.events.findAll();
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.events.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEventSchema)) body: Parameters<EventsService['update']>[1],
  ) {
    return this.events.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  remove(@Param('id') id: string) {
    return this.events.remove(id);
  }

  @Post(':id/attendees')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  addAttendee(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateAttendeeSchema)) body: Parameters<EventsService['addAttendee']>[1],
  ) {
    return this.events.addAttendee(id, body);
  }

  @Patch(':id/attendees/:attendeeId')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  updateAttendeeStatus(
    @Param('id') id: string,
    @Param('attendeeId') attendeeId: string,
    @Body(new ZodValidationPipe(UpdateAttendeeStatusSchema)) body: Parameters<EventsService['updateAttendeeStatus']>[2],
  ) {
    return this.events.updateAttendeeStatus(id, attendeeId, body);
  }

  @Delete(':id/attendees/:attendeeId')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  removeAttendee(@Param('id') id: string, @Param('attendeeId') attendeeId: string) {
    return this.events.removeAttendee(id, attendeeId);
  }
}
