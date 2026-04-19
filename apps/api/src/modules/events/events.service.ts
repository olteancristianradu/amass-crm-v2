import { Injectable, NotFoundException } from '@nestjs/common';
import { Event, EventAttendee, Prisma } from '@prisma/client';
import {
  CreateAttendeeDto,
  CreateEventDto,
  UpdateAttendeeStatusDto,
  UpdateEventDto,
} from '@amass/shared';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEventDto): Promise<Event> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.event.create({
        data: {
          tenantId: ctx.tenantId,
          name: dto.name,
          description: dto.description ?? null,
          kind: dto.kind,
          startAt: dto.startAt,
          endAt: dto.endAt,
          location: dto.location ?? null,
          capacity: dto.capacity ?? null,
          createdById: ctx.userId ?? null,
        },
      }),
    );
  }

  async findAll(): Promise<Event[]> {
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.event.findMany({
        where: { tenantId: ctx.tenantId, deletedAt: null },
        orderBy: { startAt: 'desc' },
      }),
    );
  }

  async findOne(id: string): Promise<Event & { attendees: EventAttendee[] }> {
    const ctx = requireTenantContext();
    const e = await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.event.findFirst({
        where: { id, tenantId: ctx.tenantId, deletedAt: null },
        include: { attendees: true },
      }),
    );
    if (!e) throw new NotFoundException({ code: 'EVENT_NOT_FOUND', message: 'Event not found' });
    return e;
  }

  async update(id: string, dto: UpdateEventDto): Promise<Event> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    const data: Prisma.EventUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
      ...(dto.startAt !== undefined ? { startAt: dto.startAt } : {}),
      ...(dto.endAt !== undefined ? { endAt: dto.endAt } : {}),
      ...(dto.location !== undefined ? { location: dto.location } : {}),
      ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
    };
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.event.update({ where: { id }, data }),
    );
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.event.update({ where: { id }, data: { deletedAt: new Date() } }),
    );
  }

  async addAttendee(eventId: string, dto: CreateAttendeeDto): Promise<EventAttendee> {
    await this.findOne(eventId);
    const ctx = requireTenantContext();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.eventAttendee.create({
        data: {
          eventId,
          contactId: dto.contactId ?? null,
          clientId: dto.clientId ?? null,
          email: dto.email ?? null,
          fullName: dto.fullName ?? null,
          status: dto.status,
          registeredAt: dto.status === 'REGISTERED' ? new Date() : null,
        },
      }),
    );
  }

  async updateAttendeeStatus(
    eventId: string,
    attendeeId: string,
    dto: UpdateAttendeeStatusDto,
  ): Promise<EventAttendee> {
    await this.findOne(eventId);
    const ctx = requireTenantContext();
    const now = new Date();
    return this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.eventAttendee.update({
        where: { id: attendeeId },
        data: {
          status: dto.status,
          ...(dto.status === 'REGISTERED' ? { registeredAt: now } : {}),
          ...(dto.status === 'ATTENDED' ? { attendedAt: now } : {}),
        },
      }),
    );
  }

  async removeAttendee(eventId: string, attendeeId: string): Promise<void> {
    await this.findOne(eventId);
    const ctx = requireTenantContext();
    await this.prisma.runWithTenant(ctx.tenantId, (tx) =>
      tx.eventAttendee.delete({ where: { id: attendeeId } }),
    );
  }
}
