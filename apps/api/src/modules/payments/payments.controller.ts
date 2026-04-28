import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CreatePaymentDto, CreatePaymentSchema } from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { PaymentsService } from './payments.service';

/**
 * Payments live under an invoice. The generic list endpoint is kept
 * minimal — drill-down from invoice → payments is the intended UX.
 *   GET    /invoices/:invoiceId/payments     list
 *   POST   /invoices/:invoiceId/payments     record
 *   DELETE /payments/:id                     soft-delete (undoes recompute)
 */
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('invoices/:invoiceId/payments')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Param('invoiceId') invoiceId: string) {
    return this.payments.list(invoiceId);
  }

  @Post('invoices/:invoiceId/payments')
  @RequireCedar({
    action: 'payment::create',
    resource: (req) => `Invoice::${(req as { params: { invoiceId: string } }).params.invoiceId}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(
    @Param('invoiceId') invoiceId: string,
    @Body(new ZodValidationPipe(CreatePaymentSchema)) dto: CreatePaymentDto,
  ) {
    return this.payments.create(invoiceId, dto);
  }

  @Delete('payments/:id')
  @HttpCode(204)
  @RequireCedar({
    action: 'payment::delete',
    resource: (req) => `Payment::${(req as { params: { id: string } }).params.id}`,
  })
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  remove(@Param('id') id: string) {
    return this.payments.remove(id);
  }
}
