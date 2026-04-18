import { Controller, Get, HttpCode, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@Query('unread') unread?: string) {
    return this.svc.list(unread === 'true');
  }

  @Get('unread-count')
  unreadCount() {
    return this.svc.unreadCount().then((count) => ({ count }));
  }

  @Patch(':id/read')
  @HttpCode(200)
  markRead(@Param('id') id: string) {
    return this.svc.markRead(id);
  }

  @Patch('read-all')
  @HttpCode(200)
  markAllRead() {
    return this.svc.markAllRead();
  }
}
