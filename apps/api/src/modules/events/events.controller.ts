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
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { EventsService } from './events.service';

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  @RequireCedar({ action: 'event::create', resource: 'Event::*' })
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
  @RequireCedar({
    action: 'event::update',
    resource: (req) => `Event::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEventSchema)) body: Parameters<EventsService['update']>[1],
  ) {
    return this.events.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequireCedar({
    action: 'event::delete',
    resource: (req) => `Event::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  remove(@Param('id') id: string) {
    return this.events.remove(id);
  }

  @Post(':id/attendees')
  @RequireCedar({
    action: 'attendee::create',
    resource: (req) => `Event::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  addAttendee(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateAttendeeSchema)) body: Parameters<EventsService['addAttendee']>[1],
  ) {
    return this.events.addAttendee(id, body);
  }

  @Patch(':id/attendees/:attendeeId')
  @RequireCedar({
    action: 'attendee::update',
    resource: (req) => `Attendee::${(req as { params: { attendeeId: string } }).params.attendeeId}`,
  })
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
  @RequireCedar({
    action: 'attendee::delete',
    resource: (req) => `Attendee::${(req as { params: { attendeeId: string } }).params.attendeeId}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  removeAttendee(@Param('id') id: string, @Param('attendeeId') attendeeId: string) {
    return this.events.removeAttendee(id, attendeeId);
  }
}
