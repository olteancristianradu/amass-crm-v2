import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RedisModule } from '../../infra/redis/redis.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarRefreshScheduler } from './calendar-refresh.scheduler';

@Module({
  // RedisModule needed for OAuth state nonce storage (M-aud-H8 CSRF
  // mitigation in CalendarService.{buildAuthUrl,consumeOAuthState}).
  imports: [AuthModule, RedisModule],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarRefreshScheduler],
  exports: [CalendarService],
})
export class CalendarModule {}
