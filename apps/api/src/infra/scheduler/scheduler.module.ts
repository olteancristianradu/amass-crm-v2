import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { GdprModule } from '../../modules/gdpr/gdpr.module';
import { MaintenanceScheduler } from './maintenance.scheduler';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GdprModule,
  ],
  providers: [MaintenanceScheduler],
})
export class SchedulerModule {}
