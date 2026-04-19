import {
  Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards,
} from '@nestjs/common';
import {
  CreateAttendeeSchema,
  CreateEventSchema,
  UpdateAttendeeStatusSchema,
  UpdateEventSchema,
} from '@amass/shared';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { EventsService } from './events.service';

@Controller('events')
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(CreateEventSchema)) body: Parameters<EventsService['create']>[0]) {
    return this.events.create(body);
  }

  @Get()
  findAll() {
    return this.events.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.events.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateEventSchema)) body: Parameters<EventsService['update']>[1],
  ) {
    return this.events.update(id, body);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@Param('id') id: string) {
    return this.events.remove(id);
  }

  @Post(':id/attendees')
  addAttendee(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CreateAttendeeSchema)) body: Parameters<EventsService['addAttendee']>[1],
  ) {
    return this.events.addAttendee(id, body);
  }

  @Patch(':id/attendees/:attendeeId')
  updateAttendeeStatus(
    @Param('id') id: string,
    @Param('attendeeId') attendeeId: string,
    @Body(new ZodValidationPipe(UpdateAttendeeStatusSchema)) body: Parameters<EventsService['updateAttendeeStatus']>[2],
  ) {
    return this.events.updateAttendeeStatus(id, attendeeId, body);
  }

  @Delete(':id/attendees/:attendeeId')
  @HttpCode(204)
  removeAttendee(@Param('id') id: string, @Param('attendeeId') attendeeId: string) {
    return this.events.removeAttendee(id, attendeeId);
  }
}
