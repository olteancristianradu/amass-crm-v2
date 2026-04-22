import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ChangeInvoiceStatusDto,
  ChangeInvoiceStatusSchema,
  CreateInvoiceDto,
  CreateInvoiceSchema,
  ListInvoicesQueryDto,
  ListInvoicesQuerySchema,
  UpdateInvoiceDto,
  UpdateInvoiceSchema,
} from '@amass/shared';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../auth/jwt.guard';
import { CedarGuard } from '../access-control/cedar.guard';
import { RequireCedar } from '../access-control/cedar.decorator';
import { InvoicesService } from './invoices.service';

/**
 * Routes:
 *   POST   /invoices             create (DRAFT)
 *   GET    /invoices             list + filter (cursor pagination)
 *   GET    /invoices/:id         single invoice with lines + payments
 *   PATCH  /invoices/:id         update DRAFT fields / replace lines
 *   POST   /invoices/:id/status  transition status (FSM-validated)
 *   DELETE /invoices/:id         soft delete (DRAFT/CANCELLED only)
 */
@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard, CedarGuard)
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  create(@Body(new ZodValidationPipe(CreateInvoiceSchema)) dto: CreateInvoiceDto) {
    return this.invoices.create(dto);
  }

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  list(@Query(new ZodValidationPipe(ListInvoicesQuerySchema)) q: ListInvoicesQueryDto) {
    return this.invoices.list(q);
  }

  @Get(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  findOne(@Param('id') id: string) {
    return this.invoices.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateInvoiceSchema)) dto: UpdateInvoiceDto,
  ) {
    return this.invoices.update(id, dto);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT)
  @RequireCedar({ action: 'invoice::change-status', resource: (req) => `Invoice::${(req as { params: { id: string } }).params.id}` })
  changeStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ChangeInvoiceStatusSchema)) dto: ChangeInvoiceStatusDto,
  ) {
    return this.invoices.changeStatus(id, dto);
  }

  @Get(':id/pdf-url')
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.AGENT, UserRole.VIEWER)
  pdfUrl(@Param('id') id: string) {
    return this.invoices.getPdfUrl(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  @RequireCedar({ action: 'invoice::delete', resource: (req) => `Invoice::${(req as { params: { id: string } }).params.id}` })
  remove(@Param('id') id: string) {
    return this.invoices.remove(id);
  }
}
