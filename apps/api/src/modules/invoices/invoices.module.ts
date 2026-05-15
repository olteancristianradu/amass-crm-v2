import { Module } from '@nestjs/common';
import { WsModule } from '../../infra/ws/ws.module';
import { AccessControlModule } from '../access-control/access-control.module';
import { AuthModule } from '../auth/auth.module';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InvoicePdfService } from './invoice-pdf.service';

/**
 * S22 Invoices. ActivitiesService + AuditService are @Global so no import
 * is needed for them. PaymentsModule re-uses InvoicesService for status
 * recomputation — we export it. StorageModule is @Global, no import needed.
 * WsModule provides SyncPublisherService for invoice.status_changed
 * broadcasts (B1-PR2).
 */
@Module({
  imports: [AuthModule, AccessControlModule, WsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, InvoicePdfService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
