import { Injectable } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { requireTenantContext } from '../../infra/prisma/tenant-context';
import { NotificationsGateway } from './notifications.gateway';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  data?: Prisma.InputJsonValue;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: NotificationsGateway,
  ) {}

  async create(tenantId: string, input: CreateNotificationInput) {
    const notification = await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.notification.create({
        data: {
          tenantId,
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body ?? null,
          data: input.data ?? Prisma.DbNull,
        },
      }),
    );

    // Push real-time event
    this.gateway.emitToUser(tenantId, input.userId, 'notification', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      body: notification.body,
      data: notification.data,
      createdAt: notification.createdAt,
    });

    return notification;
  }

  async list(unreadOnly: boolean) {
    const { tenantId, userId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.notification.findMany({
        where: {
          tenantId,
          userId: userId!,
          ...(unreadOnly ? { isRead: false } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    );
  }

  async markRead(id: string) {
    const { tenantId, userId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.notification.updateMany({
        where: { id, tenantId, userId: userId! },
        data: { isRead: true, readAt: new Date() },
      }),
    );
  }

  async markAllRead() {
    const { tenantId, userId } = requireTenantContext();
    await this.prisma.runWithTenant(tenantId, (tx) =>
      tx.notification.updateMany({
        where: { tenantId, userId: userId!, isRead: false },
        data: { isRead: true, readAt: new Date() },
      }),
    );
  }

  async unreadCount(): Promise<number> {
    const { tenantId, userId } = requireTenantContext();
    return this.prisma.runWithTenant(tenantId, (tx) =>
      tx.notification.count({ where: { tenantId, userId: userId!, isRead: false } }),
    );
  }
}
