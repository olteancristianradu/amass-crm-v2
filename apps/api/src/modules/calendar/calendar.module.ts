import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';
import { CalendarRefreshScheduler } from './calendar-refresh.scheduler';

@Module({
  imports: [AuthModule],
  controllers: [CalendarController],
  providers: [CalendarService, CalendarRefreshScheduler],
  exports: [CalendarService],
})
export class CalendarModule {}
