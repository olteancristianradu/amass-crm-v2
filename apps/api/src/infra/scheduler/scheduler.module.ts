import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { CasesModule } from '../../modules/cases/cases.module';
import { GdprModule } from '../../modules/gdpr/gdpr.module';
import { InvoicesModule } from '../../modules/invoices/invoices.module';
import { MaintenanceScheduler } from './maintenance.scheduler';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    GdprModule,
    InvoicesModule,
    CasesModule,
  ],
  providers: [MaintenanceScheduler],
})
export class SchedulerModule {}
