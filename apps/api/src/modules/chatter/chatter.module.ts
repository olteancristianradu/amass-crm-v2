import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatterController } from './chatter.controller';
import { ChatterService } from './chatter.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ChatterController],
  providers: [ChatterService],
  exports: [ChatterService],
})
export class ChatterModule {}
