import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

/**
 * S22 Invoices. ActivitiesService + AuditService are @Global so no import
 * is needed for them. PaymentsModule re-uses InvoicesService for status
 * recomputation — we export it.
 */
@Module({
  imports: [AuthModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
